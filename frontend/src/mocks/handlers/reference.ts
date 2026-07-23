import { http, HttpResponse } from "msw";
import { db } from "../db/store";
import { toCategory, toZone } from "../serializers";
import { findNearestActiveZone } from "../lib/geo";
import { requireAuth } from "../lib/http";
import type { ZoneSuggestionRequest } from "../../types/api";

const BASE = "/api/v1";

export const referenceHandlers = [
  http.get(`${BASE}/categories`, () => {
    return HttpResponse.json(db.categories.map(toCategory));
  }),

  http.get(`${BASE}/zones`, () => {
    return HttpResponse.json(db.zones.map(toZone));
  }),

  http.post(`${BASE}/zones/suggest`, async ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    const body = (await request.json()) as ZoneSuggestionRequest;
    if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
      return HttpResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "latitude and longitude are required.",
          },
        },
        { status: 400 },
      );
    }
    const nearest = findNearestActiveZone(db.zones, body.latitude, body.longitude);
    return HttpResponse.json({ suggestedZone: nearest ? toZone(nearest) : null });
  }),
];
