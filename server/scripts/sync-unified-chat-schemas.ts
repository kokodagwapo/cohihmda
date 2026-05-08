import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { UNIFIED_CHAT_SCHEMAS } from "../src/contracts/chat/unifiedChatSchemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, "../../docs/planning/schemas/cohi-chat-unified");
const checkOnly = process.argv.includes("--check");

function formatJson(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

async function checkFile(path: string, expected: string): Promise<boolean> {
  try {
    const actual = await readFile(path, "utf8");
    return actual === expected;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const drifted: string[] = [];

  for (const { fileName, schema } of UNIFIED_CHAT_SCHEMAS) {
    const filePath = resolve(outputDir, fileName);
    const content = formatJson(schema);
    if (checkOnly) {
      const inSync = await checkFile(filePath, content);
      if (!inSync) drifted.push(fileName);
      continue;
    }
    await writeFile(filePath, content, "utf8");
  }

  if (checkOnly && drifted.length > 0) {
    throw new Error(
      `Unified chat schema docs are out of sync: ${drifted.join(", ")}. Run: npm run schemas:chat:sync`,
    );
  }

  if (!checkOnly) {
    console.log(`Synced ${UNIFIED_CHAT_SCHEMAS.length} unified chat schema files to docs.`);
  } else {
    console.log("Unified chat schema docs are in sync.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
