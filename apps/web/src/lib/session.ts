import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "./api.ts";

export const meQueryKey = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: api.me,
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000,
  });
}
