import { apiFetch } from "./http";
import type { PublicOfficerStats } from "@/types/api";

export function getPublicOfficerStats(officerId: string): Promise<PublicOfficerStats> {
  return apiFetch<PublicOfficerStats>(`/officers/${officerId}/stats`);
}
