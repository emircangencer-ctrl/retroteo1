package app.retroplay.tv;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A small upload page on the home network: open http://<tv>:<port> on a phone or computer, enter
 * the 4-digit code shown on the TV, pick game files, and they land in the {@link Inbox}. It runs
 * only while the app is open on the TV. Requests are plain HTTP/1.1, one per connection; uploads
 * are raw request bodies (one file per request), so no multipart parsing is needed.
 */
final class UploadServer {
    interface Listener {
        void onReceived(Inbox.Entry entry);
    }

    static final int FIRST_PORT = 8686;
    private static final long MAX_FILE = 4L * 1024 * 1024 * 1024;
    private static final long KEEP_FREE = 200L * 1024 * 1024;

    private final Inbox inbox;
    private final byte[] page;
    private final String deviceName;
    private final Listener listener;
    private final String code;
    private ServerSocket socket;
    private ExecutorService pool;
    private int failures = 0;
    private long lockedUntil = 0;

    UploadServer(Inbox inbox, byte[] page, String deviceName, Listener listener) {
        this.inbox = inbox;
        this.page = page;
        this.deviceName = deviceName;
        this.listener = listener;
        this.code = String.format(Locale.ROOT, "%04d", new SecureRandom().nextInt(10000));
    }

    String code() {
        return code;
    }

    synchronized boolean running() {
        return socket != null && !socket.isClosed();
    }

    synchronized int port() {
        return running() ? socket.getLocalPort() : -1;
    }

    synchronized boolean start() {
        if (running()) return true;
        for (int port = FIRST_PORT; port < FIRST_PORT + 10; port++) {
            try {
                ServerSocket s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(port));
                socket = s;
                break;
            } catch (IOException ignored) {
                // port in use: try the next one
            }
        }
        if (socket == null) return false;
        pool = Executors.newFixedThreadPool(4);
        final ServerSocket server = socket;
        Thread accept = new Thread(() -> {
            while (!server.isClosed()) {
                try {
                    Socket client = server.accept();
                    client.setSoTimeout(60_000);
                    pool.execute(() -> handle(client));
                } catch (IOException e) {
                    if (server.isClosed()) return;
                } catch (RuntimeException e) {
                    return;
                }
            }
        }, "RetroPlayUpload");
        accept.setDaemon(true);
        accept.start();
        return true;
    }

    synchronized void stop() {
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        socket = null;
        if (pool != null) pool.shutdownNow();
        pool = null;
    }

    /** The address a phone on the same network can open, or null without a network. */
    static String lanAddress() {
        try {
            String fallback = null;
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback() || nif.isVirtual()) continue;
                for (InetAddress address : Collections.list(nif.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
                    String host = address.getHostAddress();
                    String name = nif.getName().toLowerCase(Locale.ROOT);
                    if (address.isSiteLocalAddress() && (name.startsWith("wlan") || name.startsWith("eth"))) return host;
                    if (fallback == null && address.isSiteLocalAddress()) fallback = host;
                }
            }
            return fallback;
        } catch (Exception e) {
            return null;
        }
    }

    // ---- one request -----------------------------------------------------------------------------
    private static final class Request {
        String method;
        String path;
        final Map<String, String> query = new HashMap<>();
        final Map<String, String> headers = new HashMap<>();
    }

    private void handle(Socket client) {
        try (Socket c = client) {
            InputStream in = new BufferedInputStream(c.getInputStream(), 64 * 1024);
            OutputStream out = c.getOutputStream();
            Request request = readHead(in);
            if (request == null) return;
            route(request, in, out);
            out.flush();
        } catch (IOException ignored) {
            // the phone went away
        }
    }

    private void route(Request r, InputStream in, OutputStream out) throws IOException {
        if ("GET".equals(r.method) && ("/".equals(r.path) || "/index.html".equals(r.path))) {
            send(out, 200, "text/html; charset=utf-8", page);
            return;
        }
        if ("/favicon.ico".equals(r.path)) {
            send(out, 204, "text/plain", new byte[0]);
            return;
        }
        if (!r.path.startsWith("/api/")) {
            sendJson(out, 404, "{\"ok\":false,\"error\":\"Bulunamadı\"}");
            return;
        }
        if (!authorized(r)) {
            sendJson(out, 403, "{\"ok\":false,\"error\":\"Kod yanlış. TV ekranındaki 4 haneli kodu gir.\"}");
            return;
        }
        if ("GET".equals(r.method) && "/api/status".equals(r.path)) {
            sendJson(out, 200, "{\"ok\":true,\"name\":" + Json.quote(deviceName) + ",\"files\":" + inbox.json() + "}");
            return;
        }
        if (("PUT".equals(r.method) || "POST".equals(r.method)) && "/api/upload".equals(r.path)) {
            if (r.headers.containsKey("transfer-encoding")) {
                sendJson(out, 411, "{\"ok\":false,\"error\":\"Dosya boyutu bilinmiyor\"}");
                return;
            }
            long length;
            try {
                length = Long.parseLong(r.headers.getOrDefault("content-length", "-1"));
            } catch (NumberFormatException e) {
                length = -1;
            }
            if (length <= 0 || length > MAX_FILE) {
                sendJson(out, 413, "{\"ok\":false,\"error\":\"Dosya boş ya da çok büyük\"}");
                return;
            }
            if (inbox.freeSpace() - length < KEEP_FREE) {
                sendJson(out, 507, "{\"ok\":false,\"error\":\"TV'de yeterli boş yer yok\"}");
                return;
            }
            if ("100-continue".equalsIgnoreCase(r.headers.get("expect"))) {
                out.write("HTTP/1.1 100 Continue\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                out.flush();
            }
            Inbox.Entry entry = inbox.receive(r.query.getOrDefault("name", "dosya"), in, length);
            if (listener != null) listener.onReceived(entry);
            sendJson(out, 200, "{\"ok\":true,\"id\":" + Json.quote(entry.id) + ",\"name\":" + Json.quote(entry.name) + ",\"size\":" + entry.size + "}");
            return;
        }
        sendJson(out, 405, "{\"ok\":false,\"error\":\"İzin verilmeyen istek\"}");
    }

    private synchronized boolean authorized(Request r) {
        long now = System.currentTimeMillis();
        if (now < lockedUntil) return false;
        String given = r.query.get("k");
        if (given == null) given = r.headers.get("x-retroplay-code");
        if (code.equals(given)) {
            failures = 0;
            return true;
        }
        if (++failures >= 10) {
            failures = 0;
            lockedUntil = now + 60_000;
        }
        return false;
    }

    private static Request readHead(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream(1024);
        int state = 0;
        while (state < 4) {
            int b = in.read();
            if (b < 0) return null;
            head.write(b);
            if (head.size() > 16 * 1024) return null;
            state = (b == '\r' && (state == 0 || state == 2)) ? state + 1 : (b == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
        }
        String[] lines = head.toString(StandardCharsets.ISO_8859_1.name()).split("\r\n");
        String[] first = lines[0].split(" ");
        if (first.length < 2) return null;
        Request r = new Request();
        r.method = first[0].toUpperCase(Locale.ROOT);
        String target = first[1];
        int q = target.indexOf('?');
        r.path = q >= 0 ? target.substring(0, q) : target;
        if (q >= 0) {
            for (String pair : target.substring(q + 1).split("&")) {
                int eq = pair.indexOf('=');
                if (eq <= 0) continue;
                try {
                    r.query.put(URLDecoder.decode(pair.substring(0, eq), "UTF-8"), URLDecoder.decode(pair.substring(eq + 1), "UTF-8"));
                } catch (IllegalArgumentException ignored) {
                }
            }
        }
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon > 0) r.headers.put(lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT), lines[i].substring(colon + 1).trim());
        }
        return r;
    }

    private static void sendJson(OutputStream out, int status, String body) throws IOException {
        send(out, status, "application/json; charset=utf-8", body.getBytes(StandardCharsets.UTF_8));
    }

    private static void send(OutputStream out, int status, String type, byte[] body) throws IOException {
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Error";
        String head = "HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: " + type + "\r\n"
            + "Content-Length: " + body.length + "\r\n"
            + "Cache-Control: no-store\r\n"
            + "X-Content-Type-Options: nosniff\r\n"
            + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
    }
}
