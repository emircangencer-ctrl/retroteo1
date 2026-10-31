package app.retroplay.tv;

/**
 * The sites the app may show: the live RetroPlay site and the deploy previews of its pull requests
 * (Netlify: deploy-preview-<n>--<site>.netlify.app), for trying a change on the TV before it goes
 * live. Plain strings, so it is testable without Android.
 */
final class Sites {
    private static final String PREVIEW = "deploy-preview-";

    private Sites() {
    }

    /** The live site for the address the app was built with (a branch build opens a preview). */
    static String live(String startUrl) {
        String host = host(startUrl);
        if (host == null) return startUrl;
        String bare = host.replaceFirst("^" + PREVIEW + "\\d{1,6}--", "");
        return "https://" + bare + "/";
    }

    /**
     * "live" → the live site; a pull request number (1–999999) → its deploy preview; anything else,
     * or a site that is not on Netlify → null.
     */
    static String resolve(String startUrl, String which) {
        if (which == null) return null;
        String live = live(startUrl);
        if ("live".equals(which)) return live;
        if (!which.matches("[1-9]\\d{0,5}")) return null;
        String host = host(live);
        if (host == null || !host.endsWith(".netlify.app")) return null;
        return "https://" + PREVIEW + which + "--" + host + "/";
    }

    /** The pull request number of a deploy preview address, or 0 for the live site. */
    static int preview(String url) {
        String host = host(url);
        if (host == null || !host.startsWith(PREVIEW)) return 0;
        String rest = host.substring(PREVIEW.length());
        int dash = rest.indexOf("--");
        if (dash < 1) return 0;
        try {
            return Integer.parseInt(rest.substring(0, dash));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** True for the live site and its deploy previews (https only). */
    static boolean allowed(String startUrl, String url) {
        if (url == null || !url.startsWith("https://")) return false;
        String host = host(url);
        String liveHost = host(live(startUrl));
        if (host == null || liveHost == null) return false;
        return host.equals(liveHost) || (liveHost.endsWith(".netlify.app") && host.matches(PREVIEW + "[1-9]\\d{0,5}--" + java.util.regex.Pattern.quote(liveHost)));
    }

    static String host(String url) {
        if (url == null) return null;
        int start = url.indexOf("://");
        if (start < 0) return null;
        start += 3;
        int end = start;
        while (end < url.length() && "/?#:".indexOf(url.charAt(end)) < 0) end++;
        String host = url.substring(start, end).toLowerCase(java.util.Locale.ROOT);
        return host.isEmpty() ? null : host;
    }
}
