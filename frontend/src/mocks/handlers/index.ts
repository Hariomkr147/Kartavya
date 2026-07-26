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

/** Every mock handler — one per operation in backend/api/openapi.yaml, with no gaps. */
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
];
