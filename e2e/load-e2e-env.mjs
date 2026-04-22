import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..");

const DEFAULT_E2E_ENV_FILES = [
  path.join(repoRoot, ".env.e2e"),
  path.join(repoRoot, ".env.e2e.local"),
];

const REQUIRED_E2E_ENV_KEYS = [
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
  "E2E_ADMIN_TOTP_SECRET",
];

const OPTIONAL_E2E_ENV_KEYS = [
  "E2E_BASE_URL",
  "E2E_ADMIN_TENANT_SLUG",
  "E2E_MANAGED_EMAIL_PREFIX",
  "E2E_PLATFORM_ADMIN_EMAIL",
  "E2E_PLATFORM_ADMIN_PASSWORD",
  "E2E_PLATFORM_ADMIN_TOTP_SECRET",
];

function normalizeValue(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];
  const isQuoted =
    (firstChar === '"' && lastChar === '"') ||
    (firstChar === "'" && lastChar === "'");

  if (!isQuoted) {
    return trimmed;
  }

  const inner = trimmed.slice(1, -1);
  if (firstChar === '"') {
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  return inner.replace(/\\'/g, "'");
}

function parseEnvFile(content) {
  const entries = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIdx = normalized.indexOf("=");
    if (separatorIdx === -1) continue;

    const key = normalized.slice(0, separatorIdx).trim();
    if (!key) continue;

    const value = normalized.slice(separatorIdx + 1);
    entries[key] = normalizeValue(value);
  }

  return entries;
}

export function loadE2EEnv(envFiles = DEFAULT_E2E_ENV_FILES) {
  const loadedFiles = [];

  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) continue;

    const parsed = parseEnvFile(fs.readFileSync(envFile, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = value;
      }
    }
    loadedFiles.push(envFile);
  }

  return {
    repoRoot,
    loadedFiles,
    envFiles,
  };
}

export function getRequiredE2EEnvKeys() {
  return [...REQUIRED_E2E_ENV_KEYS];
}

export function getOptionalE2EEnvKeys() {
  return [...OPTIONAL_E2E_ENV_KEYS];
}

export function getMissingRequiredE2EEnv() {
  return REQUIRED_E2E_ENV_KEYS.filter((key) => {
    const value = process.env[key];
    return !value || !value.trim();
  });
}

