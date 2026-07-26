import { useQuery } from "@tanstack/react-query";
import { reverseGeocodeLandmark } from "@/lib/reverseGeocode";

export function useLandmark(lat: number | undefined, lng: number | undefined) {
  return useQuery({
    queryKey: ["landmark", lat, lng],
    queryFn: () => reverseGeocodeLandmark(lat!, lng!),
    enabled: lat != null && lng != null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}
