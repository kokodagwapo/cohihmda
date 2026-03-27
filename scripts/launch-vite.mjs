/**
 * Run Vite using *this repo's* node_modules only.
 * Fixes Windows setups where NODE_PATH or a global install under the user
 * profile (e.g. C:\Users\<you>\node_modules) pulls the wrong esbuild and
 * Vite dies with "The service is no longer running".
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");

if (!existsSync(viteBin)) {
  console.error(
    "[launch-vite] Missing project Vite. From the repo root run: npm install",
  );
  process.exit(1);
}

const env = { ...process.env };
delete env.NODE_PATH;

const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
