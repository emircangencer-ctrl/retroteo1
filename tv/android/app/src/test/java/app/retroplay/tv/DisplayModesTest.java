package app.retroplay.tv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DisplayModesTest {
    private static int choose(int w, int h, float hz, int[][] modes, float[] rates) {
        int[] ws = new int[modes.length], hs = new int[modes.length];
        for (int i = 0; i < modes.length; i++) { ws[i] = modes[i][0]; hs[i] = modes[i][1]; }
        return DisplayModes.choose(w, h, hz, ws, hs, rates);
    }

    @Test
    public void keepsAModeThatIsAlreadySixtyHertz() {
        assertEquals(-1, choose(3840, 2160, 60f, new int[][]{{3840, 2160}, {3840, 2160}}, new float[]{60f, 50f}));
        assertEquals(-1, choose(1920, 1080, 59.94f, new int[][]{{1920, 1080}}, new float[]{60f}));
        assertTrue(DisplayModes.isSixty(59.94f));
        assertFalse(DisplayModes.isSixty(50f));
    }

    @Test
    public void fiftyHertzAsksForSixtyAtTheSameResolution() {
        int[][] modes = {{3840, 2160}, {3840, 2160}, {3840, 2160}, {1920, 1080}};
        assertEquals(1, choose(3840, 2160, 50f, modes, new float[]{50f, 60f, 59.94f, 60f}));
        check(2, choose(3840, 2160, 24f, new int[][]{{3840, 2160}, {3840, 2160}, {3840, 2160}, {1920, 1080}}, new float[]{24f, 50f, 59.94f, 60f}), "59.94 Hz when 60 is not offered at this resolution");
    }

    @Test
    public void withoutSixtyAtThisResolutionTheLargestResolutionWithSixty() {
        int[][] modes = {{3840, 2160}, {1920, 1080}, {1280, 720}};
        assertEquals(1, choose(3840, 2160, 50f, modes, new float[]{50f, 60f, 60f}));
    }

    @Test
    public void noSixtyHertzModeKeepsTheCurrentOne() {
        assertEquals(-1, choose(1920, 1080, 50f, new int[][]{{1920, 1080}, {1280, 720}}, new float[]{50f, 50f}));
        check(-1, choose(1920, 1080, 50f, new int[][]{{1920, 1080}}, new float[]{120f}), "120 Hz would play games twice as fast");
    }

    private static void check(int expected, int actual, String message) {
        org.junit.Assert.assertEquals(message, expected, actual);
    }
}
