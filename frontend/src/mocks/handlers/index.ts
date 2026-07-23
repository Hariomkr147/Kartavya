import { authHandlers } from "./auth";
import { accountHandlers } from "./account";
import { referenceHandlers } from "./reference";
import { complaintsHandlers } from "./complaints";
import { feedHandlers } from "./feed";
import { sharedHandlers } from "./shared";
import { officerHandlers } from "./officer";
import { officerPublicHandlers } from "./officerPublic";
import { adminHandlers } from "./admin";
import { gamificationHandlers } from "./gamification";
import { aiHandlers } from "./ai";

/** Every mock handler, mirroring 100% of backend/api/openapi.yaml's 51 operations. */
export const handlers = [
  ...authHandlers,
  ...accountHandlers,
  ...referenceHandlers,
  ...complaintsHandlers,
  ...feedHandlers,
  ...sharedHandlers,
  ...officerHandlers,
  ...officerPublicHandlers,
  ...adminHandlers,
  ...gamificationHandlers,
  ...aiHandlers,
];
