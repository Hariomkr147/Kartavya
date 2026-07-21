import { setupServer } from "msw/node";
import { handlers } from "./handlers/index";

/** Used by Vitest (Node environment) integration tests — see mocks/*.test.ts. */
export const server = setupServer(...handlers);
