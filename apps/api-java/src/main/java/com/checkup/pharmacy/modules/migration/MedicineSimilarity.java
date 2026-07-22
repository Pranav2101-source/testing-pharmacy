package com.checkup.pharmacy.modules.migration;

/**
 * A local string-similarity substitute for the old backend's Meilisearch-ranked medicine
 * suggestions (Meilisearch isn't part of this rebuild — see BACKLOG.md). Ranking order is
 * what old callers actually depended on (top-3, best first); the exact scoring function
 * underneath was always an external search engine's internal, undocumented ranking, so
 * there's nothing to port faithfully here beyond "closest name wins."
 */
final class MedicineSimilarity {

    private MedicineSimilarity() {
    }

    /** 1.0 = identical (case/space-insensitive), 0.0 = completely different. */
    static double score(String a, String b) {
        String x = normalise(a);
        String y = normalise(b);
        if (x.equals(y)) {
            return 1.0;
        }
        if (x.contains(y) || y.contains(x)) {
            return 0.85;
        }
        int distance = levenshtein(x, y);
        int maxLen = Math.max(x.length(), y.length());
        return maxLen == 0 ? 0 : 1.0 - ((double) distance / maxLen);
    }

    private static String normalise(String s) {
        return s.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
    }

    private static int levenshtein(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] curr = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) {
            prev[j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            curr[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                curr[j] = Math.min(Math.min(curr[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            System.arraycopy(curr, 0, prev, 0, curr.length);
        }
        return prev[b.length()];
    }
}
