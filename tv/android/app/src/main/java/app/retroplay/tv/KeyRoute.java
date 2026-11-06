package app.retroplay.tv;

import android.view.KeyEvent;

/**
 * Where a key goes. Plain rules (no Android calls) so they are tested on the build machine.
 *
 * TV remotes are not all alike: many report themselves as gamepads (the Android TV remote app,
 * IR receivers of TVs with every key bit set, Bluetooth remotes with game keys), so "has the
 * gamepad source" or "claims to have A and B" says nothing. A device counts as a controller only
 * when it has sticks or a hat (joystick axes) or has really pressed a controller button. Every
 * other d-pad is a remote, and on the app's screens its keys go to the page directly (not through
 * the WebView, whose handling of d-pad keys differs between TV makers and WebView versions).
 */
final class KeyRoute {
    /** To the controller bridge (the page reads it as a gamepad). */
    static final int GAMEPAD = 1;
    /** A remote's direction on a screen: straight to the page's navigation. */
    static final int REMOTE = 2;
    /** OK on a screen: to the WebView (a real key press) and to the page as well (see MainActivity). */
    static final int OK = 3;
    static final int BACK = 4;
    static final int MENU = 5;
    /** To the WebView as an ordinary key (in a game the remote's keys play it). */
    static final int WEB = 6;

    private KeyRoute() {
    }

    /** The page's name for a d-pad direction, or null. */
    static String direction(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "down";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "right";
            default: return null;
        }
    }

    static boolean isOk(int code) {
        return code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER;
    }

    static boolean isMenu(int code) {
        return code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            || code == KeyEvent.KEYCODE_MEDIA_PLAY || code == KeyEvent.KEYCODE_MEDIA_PAUSE;
    }

    /**
     * The buttons that make a device a controller once pressed: the named ones of a gamepad (not
     * BUTTON_1…16, which some remotes and keyboards send for their extra keys).
     */
    static boolean isControllerButton(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_BUTTON_B:
            case KeyEvent.KEYCODE_BUTTON_X:
            case KeyEvent.KEYCODE_BUTTON_Y:
            case KeyEvent.KEYCODE_BUTTON_L1:
            case KeyEvent.KEYCODE_BUTTON_R1:
            case KeyEvent.KEYCODE_BUTTON_L2:
            case KeyEvent.KEYCODE_BUTTON_R2:
            case KeyEvent.KEYCODE_BUTTON_THUMBL:
            case KeyEvent.KEYCODE_BUTTON_THUMBR:
            case KeyEvent.KEYCODE_BUTTON_START:
            case KeyEvent.KEYCODE_BUTTON_SELECT:
            case KeyEvent.KEYCODE_BUTTON_MODE:
                return true;
            default:
                return false;
        }
    }

    /**
     * @param controllerSource the event comes from a gamepad or joystick source
     * @param sticks the device has sticks or a hat (joystick axes)
     * @param pressedButtons the device has pressed a controller button before
     * @param pageRemote the page takes the remote's keys (it said so; false until it has loaded)
     * @param game a game has the keys (it runs with its menu closed)
     */
    static int route(int code, boolean controllerSource, boolean sticks, boolean pressedButtons, boolean pageRemote, boolean game) {
        boolean controller = controllerSource && (sticks || pressedButtons);
        if (isControllerButton(code)) return controllerSource ? GAMEPAD : WEB;
        if (code == KeyEvent.KEYCODE_BACK) {
            // Some controllers send Back for their Select / View button; a remote's Back is always Back.
            return controllerSource && sticks ? GAMEPAD : BACK;
        }
        if (code == KeyEvent.KEYCODE_ESCAPE) return BACK;
        if (isMenu(code)) return MENU;
        if (direction(code) != null) {
            if (controller) return GAMEPAD;
            return pageRemote && !game ? REMOTE : WEB;
        }
        if (isOk(code)) return pageRemote && !game ? OK : WEB;
        return WEB;
    }

    static String name(int route) {
        switch (route) {
            case GAMEPAD: return "kontrolcü";
            case REMOTE: return "arayüz";
            case OK: return "arayüz (OK)";
            case BACK: return "geri";
            case MENU: return "menü";
            default: return "sayfa";
        }
    }
}
