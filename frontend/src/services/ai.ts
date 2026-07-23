import { apiFetch } from "./http";
import type { CategorySuggestionResponse } from "@/types/api";

export function suggestCategory(
  description: string,
): Promise<CategorySuggestionResponse> {
  return apiFetch<CategorySuggestionResponse>("/ai/suggest-category", {
    method: "POST",
    body: { description },
  });
}
