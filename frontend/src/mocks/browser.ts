import { setupWorker } from "msw/browser";
import { handlers } from "./handlers/index";

export const worker = setupWorker(...handlers);

/** Demo credentials — every seeded account shares this password (mocks/db/seed.ts). */
export function logDemoCredentials(): void {
  console.info(
    "[Kartavya mocks] Demo logins (password: password123):\n" +
      "  Admin:    admin@kartavya.gov\n" +
      "  Officer:  officer.ward12@kartavya.gov / officer.ward07@kartavya.gov / officer.ward14@kartavya.gov\n" +
      "  Citizen:  aditi@example.com, asha@example.com, kiran@example.com, meera@example.com, ...",
  );
}
