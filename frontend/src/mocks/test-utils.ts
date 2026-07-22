// Absolute so it resolves the same whether the global fetch is jsdom's or
// Node's own (a bare relative URL needs a `window.location` base that isn't
// guaranteed to be wired up the same way in every test environment).
const BASE = "http://localhost/api/v1";

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  return (await res.json()) as { token: string; user: { id: string; role: string } };
}

export function authedFetch(token: string) {
  return (path: string, init: RequestInit = {}) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
}

export function makePhoto(name = "evidence.jpg"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/jpeg" });
}
