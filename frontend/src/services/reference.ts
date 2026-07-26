import { apiFetch } from "./http";
import type {
  Category,
  Zone,
  ZoneSuggestionRequest,
  ZoneSuggestionResponse,
} from "@/types/api";

export function getCategories(): Promise<Category[]> {
  return apiFetch<Category[]>("/categories");
}

export function getZones(): Promise<Zone[]> {
  return apiFetch<Zone[]>("/zones");
}

export function suggestZone(
  body: ZoneSuggestionRequest,
): Promise<ZoneSuggestionResponse> {
  return apiFetch<ZoneSuggestionResponse>("/zones/suggest", { method: "POST", body });
}
