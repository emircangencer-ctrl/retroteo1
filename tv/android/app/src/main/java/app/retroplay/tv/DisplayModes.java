package app.retroplay.tv;

/**
 * Which display mode the app asks for. The emulator advances one frame per screen refresh, so a TV
 * box that outputs 50 Hz (or 24/25/30 Hz after a film) plays every game a sixth slower or worse.
 * The app asks for a mode of about 60 Hz, at the current resolution when there is one, else the
 * largest resolution that has it. Plain arrays, so it is testable without Android.
 */
final class DisplayModes {
    static final float TARGET = 60f;
    /** Refresh rates within this distance of 60 Hz count as 60 Hz (59.94 Hz included). */
    static final float TOLERANCE = 0.5f;

    private DisplayModes() {
    }

    static boolean isSixty(float refresh) {
        return Math.abs(refresh - TARGET) <= TOLERANCE;
    }

    /**
     * The index of the mode to ask for, or -1 to keep the current one (already about 60 Hz, or no
     * mode of about 60 Hz exists).
     */
    static int choose(int width, int height, float refresh, int[] widths, int[] heights, float[] rates) {
        if (isSixty(refresh)) return -1;
        int same = -1;
        int other = -1;
        for (int i = 0; i < rates.length; i++) {
            if (!isSixty(rates[i])) continue;
            if (widths[i] == width && heights[i] == height) {
                if (same < 0 || closer(rates[i], rates[same])) same = i;
            } else if (other < 0 || area(widths[i], heights[i]) > area(widths[other], heights[other])
                || (area(widths[i], heights[i]) == area(widths[other], heights[other]) && closer(rates[i], rates[other]))) {
                other = i;
            }
        }
        return same >= 0 ? same : other;
    }

    private static boolean closer(float a, float b) {
        return Math.abs(a - TARGET) < Math.abs(b - TARGET);
    }

    private static long area(int w, int h) {
        return (long) w * h;
    }
}
