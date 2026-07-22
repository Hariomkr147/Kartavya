import { http, HttpResponse } from "msw";
import { requireAuth, Errors } from "../lib/http";
import { suggestCategoryFromDescription } from "../lib/ai";
import type { CategorySuggestionRequest } from "../../types/api";

const BASE = "/api/v1";

export const aiHandlers = [
  http.post(`${BASE}/ai/suggest-category`, async ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;

    const body = (await request.json()) as CategorySuggestionRequest;
    if (!body.description?.trim()) {
      return Errors.badRequest("description must not be empty.");
    }
    return HttpResponse.json(suggestCategoryFromDescription(body.description));
  }),
];
