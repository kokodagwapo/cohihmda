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
  unifiedChatConversationCreateBodySchema,
  unifiedChatConversationRebindBodySchema,
} from "../../contracts/chat/unifiedChatSchemas.js";

function forAjvCompile(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignore, ...rest } = schema;
  return rest;
}

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});
addFormats(ajv);

export const validateUnifiedChatRequest: ValidateFunction = ajv.compile(
  forAjvCompile(unifiedChatRequestSchema),
);
export const validateUnifiedChatResponse: ValidateFunction = ajv.compile(
  forAjvCompile(unifiedChatResponseSchema),
);
export const validateUnifiedStreamEvent: ValidateFunction = ajv.compile(
  forAjvCompile(unifiedChatStreamEventSchema),
);
export const validateUnifiedConversationCreate: ValidateFunction = ajv.compile(
  forAjvCompile(unifiedChatConversationCreateBodySchema),
);
export const validateUnifiedConversationRebind: ValidateFunction = ajv.compile(
  forAjvCompile(unifiedChatConversationRebindBodySchema),
);

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
