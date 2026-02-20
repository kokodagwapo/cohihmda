/**
 * Insight Pipeline Logger
 *
 * Writes all insight generation logs to a dedicated file so they don't
 * get lost in the general server output. Each generation run creates
 * a section in the file with a timestamp header.
 *
 * Logs are written to server/logs/insights/ with one file per day.
 * The file is append-only so multiple generation runs accumulate.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGS_DIR = path.resolve(__dirname, "../../../logs/insights");
const FILE_LOGGING_ENABLED = process.env.NODE_ENV !== "production";

let currentLogFile: string | null = null;
let logBuffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function ensureLogDir(): void {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function getLogFilePath(): string {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(LOGS_DIR, `insights-${date}.log`);
}

function flushBuffer(): void {
  if (!FILE_LOGGING_ENABLED || logBuffer.length === 0) {
    logBuffer = [];
    flushTimer = null;
    return;
  }
  const filePath = currentLogFile || getLogFilePath();
  try {
    ensureLogDir();
    fs.appendFileSync(filePath, logBuffer.join(""));
  } catch (err) {
    console.error(`[InsightLogger] Failed to write log file: ${(err as Error).message}`);
  }
  logBuffer = [];
  flushTimer = null;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flushBuffer, 200);
}

function writeEntry(level: string, message: string): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level}] ${message}\n`;
  logBuffer.push(line);
  scheduleFlush();
  // Also print to stdout so dev server still shows it
  if (level === "ERROR" || level === "WARN") {
    console.warn(message);
  } else {
    console.log(message);
  }
}

/** Start a new generation run section in the log. */
export function insightLogStart(tenantId: string, dateFilter: string, channelGroup?: string): void {
  currentLogFile = getLogFilePath();
  const separator = "=".repeat(80);
  const header = [
    "",
    separator,
    `INSIGHT GENERATION — ${new Date().toISOString()}`,
    `  Tenant: ${tenantId}`,
    `  DateFilter: ${dateFilter}`,
    `  Channel: ${channelGroup || "all"}`,
    separator,
    "",
  ].join("\n");
  logBuffer.push(header);
  scheduleFlush();
}

/** Log an info-level message. */
export function insightLog(message: string): void {
  writeEntry("INFO", message);
}

/** Log a warning. */
export function insightLogWarn(message: string): void {
  writeEntry("WARN", message);
}

/** Log an error. */
export function insightLogError(message: string): void {
  writeEntry("ERROR", message);
}

/** Flush and close the current run. */
export function insightLogEnd(summary: string): void {
  writeEntry("INFO", summary);
  logBuffer.push("\n");
  flushBuffer();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  currentLogFile = null;
}

/** Get the path to today's log file (for telling the user where to look). */
export function getInsightLogPath(): string {
  return getLogFilePath();
}
