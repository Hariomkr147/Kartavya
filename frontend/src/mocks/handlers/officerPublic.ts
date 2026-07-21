import { http, HttpResponse } from "msw";
import { db } from "../db/store";
import { requireAuth, Errors } from "../lib/http";
import { fromApiId } from "../lib/ids";

const BASE = "/api/v1";

export const officerPublicHandlers = [
  http.get(`${BASE}/officers/:officerId/stats`, ({ request, params }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;

    const officer = db.users.find(
      (u) => u.id === fromApiId(String(params.officerId)) && u.role === "OFFICER",
    );
    if (!officer) return Errors.notFound();

    const totalResolved = db.complaints.filter(
      (c) => c.assignedOfficerId === officer.id && c.status === "CLOSED",
    ).length;

    return HttpResponse.json({ officerId: String(officer.id), totalResolved });
  }),
];
