/**
 * JSON Schema validators for /api/chat/v1 (draft 2020-12).
 * Schemas are defined in code for runtime portability.
 */

import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import {
  unifiedChatRequestSchema,
  unifiedChatResponseSchema,
  unifiedChatStreamEventSchema,
} from "./unifiedChatSchemaDefs.js";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});
addFormats(ajv);

export const validateUnifiedChatRequest: ValidateFunction = ajv.compile(unifiedChatRequestSchema);
export const validateUnifiedChatResponse: ValidateFunction = ajv.compile(unifiedChatResponseSchema);
export const validateUnifiedStreamEvent: ValidateFunction = ajv.compile(unifiedChatStreamEventSchema);

export function formatAjvErrors(errors: ErrorObject[] | null | undefined): {
  message: string;
  details: { path: string; message: string }[];
} {
  const details =
    errors?.map((e) => ({
      path: e.instancePath || "/",
      message: e.message ?? "invalid",
    })) ?? [];
  return {
    message: details.map((d) => `${d.path}: ${d.message}`).join("; ") || "Validation failed",
    details,
  };
}
