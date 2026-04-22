import path from "node:path";
import {
  getMissingRequiredE2EEnv,
  getOptionalE2EEnvKeys,
  getRequiredE2EEnvKeys,
  loadE2EEnv,
} from "../e2e/load-e2e-env.mjs";

const { loadedFiles, repoRoot } = loadE2EEnv();
const missingRequired = getMissingRequiredE2EEnv();

function statusLabel(isSet) {
  return isSet ? "OK" : "MISSING";
}

function printSection(title, keys) {
  console.log(`\n${title}`);
  for (const key of keys) {
    const value = process.env[key];
    console.log(`- ${key}: ${statusLabel(!!value && !!value.trim())}`);
  }
}

console.log("Cohi E2E environment check");
console.log(`Repo root: ${repoRoot}`);

if (loadedFiles.length > 0) {
  console.log("\nLoaded local E2E env files:");
  for (const file of loadedFiles) {
    console.log(`- ${path.relative(repoRoot, file)}`);
  }
} else {
  console.log("\nNo local E2E env file was loaded.");
  console.log("Create `.env.e2e.local` from `.env.e2e.example` for local runs.");
}

printSection("Required", getRequiredE2EEnvKeys());
printSection("Optional", getOptionalE2EEnvKeys());

if (missingRequired.length > 0) {
  console.error("\nMissing required E2E variables:");
  for (const key of missingRequired) {
    console.error(`- ${key}`);
  }
  process.exitCode = 1;
} else {
  console.log("\nAll required E2E variables are present.");
}

