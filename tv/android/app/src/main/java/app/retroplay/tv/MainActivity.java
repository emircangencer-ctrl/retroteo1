package app.retroplay.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.hardware.input.InputManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Hosts the RetroPlay web app full screen. The web app knows it runs here from the
 * "RetroPlayTV/<version>" token in the user agent and from window.RetroPlayTV (the bridge below):
 * it then lays itself out for a TV, moves focus with the remote, reads controllers from the
 * bridge and offers the upload page for getting game files onto the TV.
 */
public class MainActivity extends Activity implements InputManager.InputDeviceListener {
    static final String TAG = "RetroPlayTV";
    private static final int FILE_REQUEST = 41;
    private static final String INBOX_PATH = "/__tv/inbox/";

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private GamepadBridge gamepads;
    private Inbox inbox;
    private UploadServer server;
    private InputManager inputManager;
    private ValueCallback<Uri[]> fileCallback;
    private Uri startUrl;
    private String origin;
    private boolean pageLoaded = false;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        startUrl = Uri.parse(BuildConfig.START_URL);
        origin = originOf(startUrl);
        inbox = new Inbox(new File(getFilesDir(), "inbox"));
        gamepads = new GamepadBridge();
        server = new UploadServer(inbox, readAsset("upload.html"), deviceName(), entry -> runJs("window.RetroPlayTVHost && window.RetroPlayTVHost.inboxChanged && window.RetroPlayTVHost.inboxChanged()"));
        inputManager = (InputManager) getSystemService(Context.INPUT_SERVICE);
        hideSystemUi();

        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0C0F);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setTextZoom(100);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " RetroPlayTV/" + BuildConfig.VERSION_NAME);
        web.addJavascriptInterface(new Bridge(), "RetroPlayTV");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return intercept(request.getUrl());
            }
        });
        setContentView(web);
        if (state != null && web.restoreState(state) != null) {
            pageLoaded = true;
        } else {
            web.loadUrl(BuildConfig.START_URL);
        }
        web.requestFocus();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
        web.onResume();
        gamepads.scanDevices();
        inputManager.registerInputDeviceListener(this, main);
    }

    @Override
    protected void onPause() {
        // The page sees itself hidden: the game pauses and its progress is saved.
        web.onPause();
        inputManager.unregisterInputDeviceListener(this);
        gamepads.releaseAll();
        super.onPause();
    }

    @Override
    protected void onStop() {
        server.stop();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        server.stop();
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    // ---- input -------------------------------------------------------------------------------------
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // Controllers: every button goes to the bridge (never as arrow keys or Back).
        if (GamepadBridge.wants(event)) return gamepads.onKey(event);
        int code = event.getKeyCode();
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0;
        switch (code) {
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                if (down) back();
                return true;
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                if (down) runJs("window.RetroPlayTVHost && window.RetroPlayTVHost.menu()");
                return true;
            default:
                // The remote's d-pad and OK reach the page as arrow keys and Enter.
                return super.dispatchKeyEvent(event);
        }
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if (gamepads.onMotion(event)) return true;
        return super.dispatchGenericMotionEvent(event);
    }

    @Override
    public void onInputDeviceAdded(int deviceId) {
        gamepads.deviceAdded(deviceId);
    }

    @Override
    public void onInputDeviceRemoved(int deviceId) {
        gamepads.deviceRemoved(deviceId);
    }

    @Override
    public void onInputDeviceChanged(int deviceId) {
        gamepads.deviceAdded(deviceId);
    }

    /** Back: the page decides (menu, dialog, previous screen); on its home screen the app steps aside. */
    private void back() {
        if (!pageLoaded) {
            if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
            return;
        }
        web.evaluateJavascript("(function(){try{return !!(window.RetroPlayTVHost&&window.RetroPlayTVHost.back())}catch(e){return false}})()", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    // ---- files -------------------------------------------------------------------------------------
    boolean canPickFiles() {
        return pickerIntent().resolveActivity(getPackageManager()) != null;
    }

    private Intent pickerIntent() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        return intent;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != FILE_REQUEST) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        if (callback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        callback.onReceiveValue(result);
    }

    /** https://<site>/__tv/inbox/<id> → the uploaded file (read by the page with fetch). */
    /** Box art and title screens from libretro-thumbnails on GitHub (src/lib/covers.ts in the web app). */
    static boolean isCoverPicture(Uri url) {
        String path = url.getPath();
        return "https".equals(url.getScheme()) && "raw.githubusercontent.com".equals(url.getHost())
            && path != null && path.startsWith("/libretro-thumbnails/") && !path.contains("..");
    }

    WebResourceResponse intercept(Uri url) {
        if (url == null) return null;
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        String scheme = url.getScheme();
        if (!origin.equals(originOf(url))) {
            // Cover pictures: the page fetches a game's box art once from libretro-thumbnails.
            if (isCoverPicture(url)) return null;
            // Nothing else from other sites on the TV; this also keeps out the toolbar Netlify adds
            // to deploy previews, which would cover the bottom of the screen.
            if ("http".equals(scheme) || "https".equals(scheme)) return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", headers, new ByteArrayInputStream(new byte[0]));
            return null;
        }
        String path = url.getPath();
        if (path == null || !path.startsWith(INBOX_PATH)) return null;
        File file = inbox.file(path.substring(INBOX_PATH.length()));
        try {
            if (file == null) return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
            headers.put("Content-Length", String.valueOf(file.length()));
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers, new FileInputStream(file));
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 500, "Error", headers, new ByteArrayInputStream(new byte[0]));
        }
    }

    // ---- page --------------------------------------------------------------------------------------
    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Only RetroPlay itself is shown; there is no browser on a TV to hand other links to.
            return !origin.equals(originOf(request.getUrl()));
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return intercept(request.getUrl());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (origin.equals(originOf(Uri.parse(url)))) pageLoaded = true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            // First start without a network (later starts work offline through the service worker).
            pageLoaded = false;
            String html = new String(readAsset("offline.html"), StandardCharsets.UTF_8).replace("{{URL}}", BuildConfig.START_URL);
            view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            Log.i(TAG, "console: " + message.message());
            return true;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(pickerIntent(), FILE_REQUEST);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                runJs("window.RetroPlayTVHost && window.RetroPlayTVHost.noFilePicker && window.RetroPlayTVHost.noFilePicker()");
                return false;
            }
        }
    }

    /** window.RetroPlayTV in the page. Called on a background thread. */
    private final class Bridge {
        @JavascriptInterface
        public String info() {
            String address = UploadServer.lanAddress();
            return "{\"app\":\"RetroPlayTV\",\"versionName\":" + Json.quote(BuildConfig.VERSION_NAME)
                + ",\"versionCode\":" + BuildConfig.VERSION_CODE
                + ",\"sdk\":" + Build.VERSION.SDK_INT
                + ",\"model\":" + Json.quote(Build.MANUFACTURER + " " + Build.MODEL)
                + ",\"device\":" + Json.quote(deviceName())
                + ",\"address\":" + Json.quote(address)
                + ",\"filePicker\":" + canPickFiles() + "}";
        }

        @JavascriptInterface
        public int gamepadVersion() {
            return gamepads.version();
        }

        @JavascriptInterface
        public String gamepads() {
            return gamepads.json();
        }

        @JavascriptInterface
        public String inbox() {
            return inbox.json();
        }

        @JavascriptInterface
        public boolean inboxDelete(String id) {
            return inbox.delete(id);
        }

        /** Starts the upload page; {"url","address","port","code"} or {"error"}. */
        @JavascriptInterface
        public String startUpload() {
            String address = UploadServer.lanAddress();
            if (address == null) return "{\"error\":\"TV bir ağa bağlı değil.\"}";
            if (!server.start()) return "{\"error\":\"Yükleme sayfası açılamadı.\"}";
            int port = server.port();
            return "{\"url\":" + Json.quote("http://" + address + ":" + port + "/?k=" + server.code())
                + ",\"address\":" + Json.quote(address + ":" + port)
                + ",\"port\":" + port + ",\"code\":" + Json.quote(server.code()) + "}";
        }

        @JavascriptInterface
        public void stopUpload() {
            server.stop();
        }

        @JavascriptInterface
        public void setKeepScreenOn(boolean on) {
            main.post(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void exit() {
            main.post(() -> moveTaskToBack(true));
        }
    }

    // ---- helpers -----------------------------------------------------------------------------------
    private void runJs(String script) {
        main.post(() -> {
            if (web != null) web.evaluateJavascript(script, null);
        });
    }

    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private String deviceName() {
        String name = null;
        try {
            name = Settings.Global.getString(getContentResolver(), "device_name");
        } catch (RuntimeException ignored) {
        }
        return name != null && !name.isEmpty() ? name : Build.MODEL;
    }

    private byte[] readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            return out.toByteArray();
        } catch (IOException e) {
            return new byte[0];
        }
    }

    static String originOf(Uri uri) {
        if (uri == null || uri.getScheme() == null || uri.getAuthority() == null) return "";
        return uri.getScheme() + "://" + uri.getAuthority();
    }
}
