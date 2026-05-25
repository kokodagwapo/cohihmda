#!/usr/bin/env tsx
/**
 * Prepends @COHI-398 to e2e test() titles missing a Jira key (one-off / CI fix).
 * Usage: npx tsx server/scripts/qa/fixMissingJiraTags.ts [--dry-run]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(__dirname, "../../..");
const E2E_ROOT = join(REPO_ROOT, "e2e");
const DEFAULT_TAG = "@COHI-398";
const JIRA_KEY_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/;
const TEST_CALL_REGEX = /\btest(?:\.(?:skip|only|fixme|fail))?\s*\(/;

function walkSpecFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walkSpecFiles(fullPath));
    } else if (entry.endsWith(".spec.ts")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function fixTestLine(line: string): string | null {
  if (!TEST_CALL_REGEX.test(line) || line.includes("test.describe")) {
    return null;
  }
  const openParen = line.indexOf("(");
  if (openParen === -1) return null;

  let delim: "'" | '"' | "`" | null = null;
  let start = -1;
  for (let i = openParen + 1; i < line.length; i++) {
    const c = line[i];
    if (c === "'" || c === '"' || c === "`") {
      delim = c;
      start = i + 1;
      break;
    }
    if (!/\s/.test(c)) return null;
  }
  if (!delim || start === -1) return null;

  let escaped = false;
  let end = -1;
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === delim) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  const title = line.slice(start, end);
  if (JIRA_KEY_REGEX.test(title)) return null;

  return line.slice(0, start) + `${DEFAULT_TAG} ` + title + line.slice(end);
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  let changedFiles = 0;
  let changedLines = 0;

  for (const filePath of walkSpecFiles(E2E_ROOT)) {
    const rel = relative(REPO_ROOT, filePath).replace(/\\/g, "/");
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    let fileChanged = false;

    const next = lines.map((line) => {
      const fixed = fixTestLine(line);
      if (!fixed) return line;
      fileChanged = true;
      changedLines += 1;
      if (!dryRun) console.log(`${rel}: ${line.trim()} -> ${fixed.trim()}`);
      return fixed;
    });

    if (fileChanged) {
      changedFiles += 1;
      if (!dryRun) {
        writeFileSync(filePath, next.join("\n") + (readFileSync(filePath, "utf8").endsWith("\n") ? "\n" : ""));
      }
    }
  }

  console.log(
    dryRun
      ? `[dry-run] Would update ${changedLines} test titles in ${changedFiles} files`
      : `Updated ${changedLines} test titles in ${changedFiles} files`,
  );
}

main();
