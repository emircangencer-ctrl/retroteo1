package app.retroplay.tv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SitesTest {
    private static final String LIVE = "https://retroteo1.netlify.app/";
    private static final String BRANCH = "https://deploy-preview-12--retroteo1.netlify.app/";

    @Test
    public void theLiveSiteOfALiveOrABranchBuild() {
        assertEquals(LIVE, Sites.live(LIVE));
        assertEquals(LIVE, Sites.live(BRANCH));
    }

    @Test
    public void aPullRequestNumberOpensItsDeployPreview() {
        assertEquals("https://deploy-preview-9--retroteo1.netlify.app/", Sites.resolve(LIVE, "9"));
        assertEquals("https://deploy-preview-9--retroteo1.netlify.app/", Sites.resolve(BRANCH, "9"));
        assertEquals(LIVE, Sites.resolve(BRANCH, "live"));
        assertEquals(9, Sites.preview("https://deploy-preview-9--retroteo1.netlify.app/#/settings"));
        assertEquals(0, Sites.preview(LIVE));
    }

    @Test
    public void anythingElseIsRefused() {
        assertNull(Sites.resolve(LIVE, "0"));
        assertNull(Sites.resolve(LIVE, "07"));
        assertNull(Sites.resolve(LIVE, "9--evil.example"));
        assertNull(Sites.resolve(LIVE, "1234567"));
        assertNull(Sites.resolve(LIVE, null));
        none(Sites.resolve("https://retroplay.example/", "9"), "previews exist only on Netlify");
    }

    @Test
    public void onlyTheLiveSiteAndItsPreviewsAreAllowed() {
        assertTrue(Sites.allowed(LIVE, LIVE));
        assertTrue(Sites.allowed(LIVE, "https://deploy-preview-8--retroteo1.netlify.app/#/"));
        assertFalse(Sites.allowed(LIVE, "http://retroteo1.netlify.app/"));
        assertFalse(Sites.allowed(LIVE, "https://deploy-preview-8--other.netlify.app/"));
        assertFalse(Sites.allowed(LIVE, "https://evil.example/?https://retroteo1.netlify.app/"));
        assertFalse(Sites.allowed(LIVE, "https://deploy-preview-8--retroteo1.netlify.app.evil.example/"));
    }

    private static void none(String actual, String message) {
        org.junit.Assert.assertNull(message, actual);
    }
}
