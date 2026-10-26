package app.retroplay.tv;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Files sent to the TV from a phone or computer, waiting to be added to the library. Each file is
 * stored as <id>.bin with its original name in <id>.name (the name tells the app which console a
 * file is for). The web app reads them through https://<site>/__tv/inbox/<id> and deletes them
 * once they are in its library.
 */
final class Inbox {
    static final class Entry {
        final String id;
        final String name;
        final long size;
        final long time;

        Entry(String id, String name, long size, long time) {
            this.id = id;
            this.name = name;
            this.size = size;
            this.time = time;
        }
    }

    private final File dir;
    private final SecureRandom random = new SecureRandom();

    Inbox(File dir) {
        this.dir = dir;
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        // Half-written files from an interrupted upload.
        File[] partial = dir.listFiles((d, n) -> n.endsWith(".part"));
        if (partial != null) for (File f : partial) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    static boolean validId(String id) {
        return id != null && id.matches("[a-z0-9]{8,40}");
    }

    static String cleanName(String name) {
        String base = name == null ? "" : name.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1).replaceAll("[\\u0000-\\u001f]", "").trim();
        if (base.isEmpty() || base.equals(".") || base.equals("..")) base = "dosya";
        return base.length() > 180 ? base.substring(base.length() - 180) : base;
    }

    long freeSpace() {
        return dir.getUsableSpace();
    }

    /** Streams `length` bytes into a new entry; the entry appears only once it is complete. */
    synchronized Entry receive(String name, InputStream in, long length) throws IOException {
        StringBuilder tail = new StringBuilder(Integer.toString(random.nextInt(60466176), 36)); // 36^5
        while (tail.length() < 5) tail.insert(0, '0');
        String id = (Long.toString(System.currentTimeMillis(), 36) + tail).toLowerCase(Locale.ROOT);
        File part = new File(dir, id + ".part");
        long copied = 0;
        try (OutputStream out = new FileOutputStream(part)) {
            byte[] buffer = new byte[64 * 1024];
            while (copied < length) {
                int read = in.read(buffer, 0, (int) Math.min(buffer.length, length - copied));
                if (read < 0) break;
                out.write(buffer, 0, read);
                copied += read;
            }
        }
        if (copied != length) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw new IOException("Bağlantı kesildi (" + copied + "/" + length + " bayt)");
        }
        writeText(new File(dir, id + ".name"), cleanName(name));
        File done = new File(dir, id + ".bin");
        if (!part.renameTo(done)) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw new IOException("Dosya kaydedilemedi");
        }
        return new Entry(id, cleanName(name), length, done.lastModified());
    }

    synchronized List<Entry> list() {
        List<Entry> out = new ArrayList<>();
        File[] files = dir.listFiles((d, n) -> n.endsWith(".bin"));
        if (files == null) return out;
        Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File f : files) {
            String id = f.getName().substring(0, f.getName().length() - 4);
            if (!validId(id)) continue;
            out.add(new Entry(id, readText(new File(dir, id + ".name"), id), f.length(), f.lastModified()));
        }
        return out;
    }

    File file(String id) {
        if (!validId(id)) return null;
        File f = new File(dir, id + ".bin");
        return f.isFile() ? f : null;
    }

    synchronized boolean delete(String id) {
        if (!validId(id)) return false;
        boolean removed = new File(dir, id + ".bin").delete();
        //noinspection ResultOfMethodCallIgnored
        new File(dir, id + ".name").delete();
        return removed;
    }

    String json() {
        StringBuilder out = new StringBuilder("[");
        boolean first = true;
        for (Entry e : list()) {
            if (!first) out.append(',');
            first = false;
            out.append("{\"id\":").append(Json.quote(e.id))
                .append(",\"name\":").append(Json.quote(e.name))
                .append(",\"size\":").append(e.size)
                .append(",\"time\":").append(e.time).append('}');
        }
        return out.append(']').toString();
    }

    private static void writeText(File file, String text) throws IOException {
        try (OutputStream out = new FileOutputStream(file)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String readText(File file, String fallback) {
        try (InputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) Math.min(file.length(), 4096)];
            int n = in.read(bytes);
            return n > 0 ? new String(bytes, 0, n, StandardCharsets.UTF_8) : fallback;
        } catch (IOException e) {
            return fallback;
        }
    }
}
