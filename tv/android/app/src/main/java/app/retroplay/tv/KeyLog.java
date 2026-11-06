package app.retroplay.tv;

/**
 * The last key presses and where they went, for the remote test in Settings (and logcat): when a
 * remote does not work on some TV, this shows what it sends.
 */
final class KeyLog {
    static final int SIZE = 24;

    private final String[] entries = new String[SIZE];
    private int next = 0;
    private int count = 0;
    private long serial = 0;

    /** One press: the key's name, the device, its source bits, what made it a controller or not, the route. */
    synchronized String add(long time, String key, String device, int source, boolean controllerSource, boolean sticks, boolean pressedButtons, String mode, int route) {
        String entry = "{\"n\":" + (++serial)
            + ",\"t\":" + time
            + ",\"key\":" + Json.quote(key)
            + ",\"device\":" + Json.quote(device == null ? "" : device)
            + ",\"source\":" + Json.quote("0x" + Integer.toHexString(source))
            + ",\"gamepadSource\":" + controllerSource
            + ",\"sticks\":" + sticks
            + ",\"buttons\":" + pressedButtons
            + ",\"mode\":" + Json.quote(mode)
            + ",\"route\":" + Json.quote(KeyRoute.name(route)) + "}";
        entries[next] = entry;
        next = (next + 1) % SIZE;
        if (count < SIZE) count++;
        return entry;
    }

    /** Oldest first: {"n":last serial,"keys":[…]}. */
    synchronized String json() {
        StringBuilder out = new StringBuilder(128 + count * 200);
        out.append("{\"n\":").append(serial).append(",\"keys\":[");
        for (int i = 0; i < count; i++) {
            if (i > 0) out.append(',');
            out.append(entries[(next - count + i + SIZE) % SIZE]);
        }
        return out.append("]}").toString();
    }

    /** "KEYCODE_DPAD_UP" → "DPAD_UP". */
    static String keyName(String full, int code) {
        if (full == null || full.isEmpty()) return String.valueOf(code);
        return full.startsWith("KEYCODE_") ? full.substring(8) : full;
    }
}
