/**
 * JSON Schema validators for /api/chat/v1 (draft 2020-12).
 * Schemas live in docs/planning/schemas/cohi-chat-unified/
 */

import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root: server/src/services/chat -> ../../../../ */
const SCHEMA_ROOT = join(__dirname, "../../../../docs/planning/schemas/cohi-chat-unified");

function loadJson(name: string): object {
  const path = join(SCHEMA_ROOT, name);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  delete raw.$schema;
  return raw;
}

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});
addFormats(ajv);

const requestSchema = loadJson("chat-request.schema.json");
const responseSchema = loadJson("chat-response.schema.json");
const streamEventSchema = loadJson("chat-event-stream.schema.json");

export const validateUnifiedChatRequest: ValidateFunction = ajv.compile(requestSchema);
export const validateUnifiedChatResponse: ValidateFunction = ajv.compile(responseSchema);
export const validateUnifiedStreamEvent: ValidateFunction = ajv.compile(streamEventSchema);

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
