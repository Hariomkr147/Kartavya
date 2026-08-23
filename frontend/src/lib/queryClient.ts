import { QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@/services/http";

/**
 * How often a view that bills itself as live re-reads the server.
 *
 * Nothing in this app pushes — `refetchOnWindowFocus` is off below and there
 * is no socket — so "live" means exactly "polls on this interval", and every
 * view that claims it has to agree on the number. It lives here rather than
 * in each hook because it was a bare `45_000` in two of them, under a comment
 * reading "same cadence as the admin one": the constraint was written down in
 * prose where nothing could enforce it, which is how the third caller comes
 * to be 30s and nobody notices.
 *
 * The number matters because the views sit next to each other. A stat tile
 * reading "7 active" beside a map drawing 9 pins reads as a bug, not as two
 * views settling at their own pace.
 *
 * React Query pauses these while the window is out of focus
 * (`refetchIntervalInBackground` defaults to false), so a backgrounded tab
 * costs nothing.
 */
export const LIVE_REFRESH_MS = 45_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500)
          return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
