package app.retroplay.tv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.view.KeyEvent;

import org.junit.Test;

public class KeyRouteTest {
    private static final int UP = KeyEvent.KEYCODE_DPAD_UP;

    private static int route(int code, boolean gamepadSource, boolean sticks, boolean buttons, String mode) {
        return KeyRoute.route(code, gamepadSource, sticks, buttons, !"off".equals(mode), "game".equals(mode));
    }

    @Test
    public void aRemoteThatCallsItselfAGamepadStillNavigatesTheScreens() {
        // The Android TV remote app (0x701), TV IR receivers and some Bluetooth remotes carry the
        // gamepad source; without sticks and without having pressed A/B they are remotes.
        assertEquals(KeyRoute.REMOTE, route(UP, true, false, false, "ui"));
        assertEquals(KeyRoute.REMOTE, route(KeyEvent.KEYCODE_DPAD_LEFT, false, false, false, "ui"));
        assertEquals(KeyRoute.OK, route(KeyEvent.KEYCODE_DPAD_CENTER, true, false, false, "ui"));
        assertEquals(KeyRoute.OK, route(KeyEvent.KEYCODE_ENTER, false, false, false, "ui"));
        // Their Back is Back, never a controller's Select.
        assertEquals(KeyRoute.BACK, route(KeyEvent.KEYCODE_BACK, true, false, false, "ui"));
        assertEquals(KeyRoute.BACK, route(KeyEvent.KEYCODE_BACK, true, false, true, "game"));
        assertEquals(KeyRoute.BACK, route(KeyEvent.KEYCODE_BACK, false, false, false, "game"));
    }

    @Test
    public void controllersKeepTheirKeys() {
        assertEquals(KeyRoute.GAMEPAD, route(UP, true, true, false, "ui"));
        assertEquals(KeyRoute.GAMEPAD, route(UP, true, false, true, "ui"));
        assertEquals(KeyRoute.GAMEPAD, route(UP, true, true, false, "game"));
        assertEquals(KeyRoute.GAMEPAD, route(KeyEvent.KEYCODE_BUTTON_A, true, false, false, "ui"));
        assertEquals(KeyRoute.GAMEPAD, route(KeyEvent.KEYCODE_BUTTON_START, true, false, false, "off"));
        // A controller whose Select / View button sends Back.
        assertEquals(KeyRoute.GAMEPAD, route(KeyEvent.KEYCODE_BACK, true, true, false, "game"));
        // Gamepad key codes from something that is not a gamepad go to the page as keys.
        assertEquals(KeyRoute.WEB, route(KeyEvent.KEYCODE_BUTTON_A, false, false, false, "ui"));
    }

    @Test
    public void inAGameAndBeforeThePageIsReadyTheKeysGoToTheWebView() {
        assertEquals(KeyRoute.WEB, route(UP, false, false, false, "game"));
        assertEquals(KeyRoute.WEB, route(KeyEvent.KEYCODE_DPAD_CENTER, false, false, false, "game"));
        assertEquals(KeyRoute.WEB, route(UP, true, false, false, "off"));
        assertEquals(KeyRoute.WEB, route(KeyEvent.KEYCODE_ENTER, false, false, false, "off"));
        assertEquals(KeyRoute.WEB, route(KeyEvent.KEYCODE_A, false, false, false, "ui"));
        assertEquals(KeyRoute.BACK, route(KeyEvent.KEYCODE_ESCAPE, false, false, false, "off"));
        assertEquals(KeyRoute.MENU, route(KeyEvent.KEYCODE_MENU, false, false, false, "game"));
        assertEquals(KeyRoute.MENU, route(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, false, false, false, "ui"));
    }

    @Test
    public void onlyNamedControllerButtonsMakeADeviceAController() {
        assertTrue(KeyRoute.isControllerButton(KeyEvent.KEYCODE_BUTTON_B));
        assertEquals(false, KeyRoute.isControllerButton(KeyEvent.KEYCODE_BUTTON_1));
        assertEquals(false, KeyRoute.isControllerButton(KeyEvent.KEYCODE_DPAD_CENTER));
        assertEquals("up", KeyRoute.direction(UP));
        assertEquals(null, KeyRoute.direction(KeyEvent.KEYCODE_ENTER));
    }

    @Test
    public void theKeyLogKeepsTheLastPressesOldestFirst() {
        KeyLog log = new KeyLog();
        for (int i = 0; i < KeyLog.SIZE + 3; i++) log.add(i, "DPAD_UP", "TCL \"remote\"", 0x701, true, false, false, "ui", KeyRoute.REMOTE);
        String json = log.json();
        assertTrue(json.startsWith("{\"n\":" + (KeyLog.SIZE + 3) + ",\"keys\":[{\"n\":4,"));
        assertTrue(json.contains("\"device\":\"TCL \\\"remote\\\"\""));
        assertTrue(json.contains("\"source\":\"0x701\""));
        assertTrue(json.contains("\"route\":\"arayüz\""));
        assertEquals(KeyLog.SIZE, json.split("\\{\"n\":").length - 2);
        assertEquals("DPAD_UP", KeyLog.keyName("KEYCODE_DPAD_UP", 19));
        assertEquals("19", KeyLog.keyName(null, 19));
    }
}
