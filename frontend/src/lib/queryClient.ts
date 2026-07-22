import { QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@/services/http";

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
