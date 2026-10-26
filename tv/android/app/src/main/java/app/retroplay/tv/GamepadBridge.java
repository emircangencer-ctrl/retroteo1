package app.retroplay.tv;

import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Game controllers, read natively and handed to the web app as W3C "standard" gamepads.
 *
 * The Activity sees every controller event before the WebView. Controller buttons, the d-pad and
 * the sticks are consumed here (so a controller d-pad never also arrives as arrow keys, and an
 * unhandled B never turns into Back), and the page polls the state through {@link #json()}.
 * The TV remote is not a controller: its keys go on to the WebView as ordinary keys.
 */
final class GamepadBridge {
    static final int BUTTONS = 17;

    private static final class Pad {
        final int deviceId;
        final int index;
        final String name;
        final boolean[] keys = new boolean[BUTTONS];
        final float[] axes = new float[4];
        float hatX, hatY, leftTrigger, rightTrigger;
        long timestamp;

        Pad(int deviceId, int index, String name) {
            this.deviceId = deviceId;
            this.index = index;
            this.name = name;
        }
    }

    private final Map<Integer, Pad> pads = new LinkedHashMap<>();
    private int version = 0;
    private String cached = null;

    /** Controllers (gamepads and joysticks), not remotes or keyboards. */
    static boolean isControllerSource(int source) {
        return (source & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
            || (source & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    /** Android key code → standard gamepad button index (bottom face button = 0), or -1. */
    static int buttonFor(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0;
            case KeyEvent.KEYCODE_BUTTON_B: return 1;
            case KeyEvent.KEYCODE_BUTTON_X: return 2;
            case KeyEvent.KEYCODE_BUTTON_Y: return 3;
            case KeyEvent.KEYCODE_BUTTON_L1: return 4;
            case KeyEvent.KEYCODE_BUTTON_R1: return 5;
            case KeyEvent.KEYCODE_BUTTON_L2: return 6;
            case KeyEvent.KEYCODE_BUTTON_R2: return 7;
            case KeyEvent.KEYCODE_BUTTON_SELECT:
            case KeyEvent.KEYCODE_BACK: return 8; // some controllers send Back for their Select/View button
            case KeyEvent.KEYCODE_BUTTON_START: return 9;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 10;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 11;
            case KeyEvent.KEYCODE_DPAD_UP: return 12;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 13;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 14;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 15;
            case KeyEvent.KEYCODE_BUTTON_MODE: return 16;
            default: return -1;
        }
    }

    /** A key event this bridge takes over (a controller button). */
    static boolean wants(KeyEvent event) {
        return isControllerSource(event.getSource()) && buttonFor(event.getKeyCode()) >= 0;
    }

    synchronized void deviceAdded(int deviceId) {
        InputDevice device = InputDevice.getDevice(deviceId);
        if (device == null || device.isVirtual() || !isControllerSource(device.getSources())) return;
        pad(deviceId, device);
    }

    synchronized void deviceRemoved(int deviceId) {
        if (pads.remove(deviceId) != null) changed();
    }

    synchronized void scanDevices() {
        for (int id : InputDevice.getDeviceIds()) deviceAdded(id);
    }

    synchronized boolean onKey(KeyEvent event) {
        int button = buttonFor(event.getKeyCode());
        if (button < 0) return false;
        int action = event.getAction();
        if (action != KeyEvent.ACTION_DOWN && action != KeyEvent.ACTION_UP) return true;
        Pad pad = pad(event.getDeviceId(), event.getDevice());
        boolean down = action == KeyEvent.ACTION_DOWN;
        if (pad.keys[button] != down) {
            pad.keys[button] = down;
            pad.timestamp = event.getEventTime();
            changed();
        }
        return true;
    }

    synchronized boolean onMotion(MotionEvent event) {
        if (!isControllerSource(event.getSource()) || event.getAction() != MotionEvent.ACTION_MOVE) return false;
        Pad pad = pad(event.getDeviceId(), event.getDevice());
        InputDevice device = event.getDevice();
        float[] next = {
            centered(event, device, MotionEvent.AXIS_X),
            centered(event, device, MotionEvent.AXIS_Y),
            centered(event, device, MotionEvent.AXIS_Z),
            centered(event, device, MotionEvent.AXIS_RZ)
        };
        float hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X);
        float hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y);
        float lt = Math.max(event.getAxisValue(MotionEvent.AXIS_LTRIGGER), event.getAxisValue(MotionEvent.AXIS_BRAKE));
        float rt = Math.max(event.getAxisValue(MotionEvent.AXIS_RTRIGGER), event.getAxisValue(MotionEvent.AXIS_GAS));
        boolean moved = hatX != pad.hatX || hatY != pad.hatY || Math.abs(lt - pad.leftTrigger) > 0.01f || Math.abs(rt - pad.rightTrigger) > 0.01f;
        for (int i = 0; i < 4; i++) if (Math.abs(next[i] - pad.axes[i]) > 0.01f) moved = true;
        if (moved) {
            System.arraycopy(next, 0, pad.axes, 0, 4);
            pad.hatX = hatX;
            pad.hatY = hatY;
            pad.leftTrigger = lt;
            pad.rightTrigger = rt;
            pad.timestamp = event.getEventTime();
            changed();
        }
        return true;
    }

    synchronized void releaseAll() {
        for (Pad pad : pads.values()) {
            java.util.Arrays.fill(pad.keys, false);
            java.util.Arrays.fill(pad.axes, 0f);
            pad.hatX = pad.hatY = pad.leftTrigger = pad.rightTrigger = 0f;
        }
        changed();
    }

    synchronized int version() {
        return version;
    }

    /** {"v":n,"pads":[{"index":0,"id":"…","buttons":[[pressed,value]…],"axes":[…],"timestamp":t}]} */
    synchronized String json() {
        if (cached != null) return cached;
        StringBuilder out = new StringBuilder(256);
        out.append("{\"v\":").append(version).append(",\"pads\":[");
        boolean first = true;
        for (Pad pad : pads.values()) {
            if (!first) out.append(',');
            first = false;
            out.append("{\"index\":").append(pad.index)
                .append(",\"id\":").append(Json.quote(pad.name))
                .append(",\"timestamp\":").append(pad.timestamp)
                .append(",\"buttons\":[");
            for (int b = 0; b < BUTTONS; b++) {
                float value = value(pad, b);
                if (b > 0) out.append(',');
                out.append('[').append(value > 0.5f ? 1 : 0).append(',').append(round(value)).append(']');
            }
            out.append("],\"axes\":[");
            for (int a = 0; a < 4; a++) {
                if (a > 0) out.append(',');
                out.append(round(pad.axes[a]));
            }
            out.append("]}");
        }
        out.append("]}");
        cached = out.toString();
        return cached;
    }

    private float value(Pad pad, int button) {
        boolean key = pad.keys[button];
        switch (button) {
            case 6: return Math.max(key ? 1f : 0f, pad.leftTrigger);
            case 7: return Math.max(key ? 1f : 0f, pad.rightTrigger);
            case 12: return key || pad.hatY < -0.5f ? 1f : 0f;
            case 13: return key || pad.hatY > 0.5f ? 1f : 0f;
            case 14: return key || pad.hatX < -0.5f ? 1f : 0f;
            case 15: return key || pad.hatX > 0.5f ? 1f : 0f;
            default: return key ? 1f : 0f;
        }
    }

    private Pad pad(int deviceId, InputDevice device) {
        Pad pad = pads.get(deviceId);
        if (pad != null) return pad;
        String name = device != null ? device.getName() : "Kontrolcü";
        pad = new Pad(deviceId, freeIndex(), name == null ? "Kontrolcü" : name);
        pads.put(deviceId, pad);
        changed();
        return pad;
    }

    private int freeIndex() {
        List<Integer> used = new ArrayList<>();
        for (Pad pad : pads.values()) used.add(pad.index);
        for (int i = 0; ; i++) if (!used.contains(i)) return i;
    }

    private void changed() {
        version++;
        cached = null;
    }

    private static float centered(MotionEvent event, InputDevice device, int axis) {
        float value = event.getAxisValue(axis);
        if (device != null) {
            InputDevice.MotionRange range = device.getMotionRange(axis, event.getSource());
            if (range != null && Math.abs(value) <= range.getFlat()) return 0f;
        }
        return value;
    }

    private static String round(float value) {
        if (value == 0f) return "0";
        return String.valueOf(Math.round(value * 1000f) / 1000f);
    }
}
