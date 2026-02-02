#!/usr/bin/env node

/**
 * Version Generator Script
 * Generates version.json with git commit information, build timestamp, and package version
 */

import { execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper function to safely execute git commands
function getGitInfo(command, fallback = null) {
  try {
    const stdout = execSync(command, {
      encoding: "utf8",
      cwd: join(__dirname, "../.."),
      timeout: 5000,
    });
    return stdout.trim() || fallback;
  } catch (error) {
    return fallback;
  }
}

function generateVersion() {
  try {
    // Read package.json version
    const packageJsonPath = join(__dirname, "../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const packageVersion = packageJson.version || "1.0.0";

    // Get git commit SHA (check env vars first, then try git command)
    // CI/CD pipelines can pass GIT_COMMIT and GIT_BRANCH as env vars
    let commitFull =
      process.env.GIT_COMMIT ||
      process.env.BITBUCKET_COMMIT ||
      getGitInfo("git rev-parse HEAD", null);
    if (commitFull === "unknown") commitFull = null;
    const commitShort = commitFull ? commitFull.substring(0, 7) : null;

    // Get git tag (if any)
    const tag = getGitInfo(
      "git describe --tags --exact-match HEAD 2>/dev/null",
      null
    );

    // Get git branch name (check env vars first)
    const branch =
      process.env.GIT_BRANCH ||
      process.env.BITBUCKET_BRANCH ||
      getGitInfo("git rev-parse --abbrev-ref HEAD", "unknown");

    // Get build timestamp
    const buildTime = new Date().toISOString();

    // Get environment
    const environment = process.env.NODE_ENV || "development";

    // Get Elastic Beanstalk version label if available
    const ebVersionLabel =
      process.env.EB_VERSION_LABEL || process.env.VERSION_LABEL || null;

    // Construct version object
    const versionInfo = {
      version: packageVersion,
      commit: {
        short: commitShort,
        full: commitFull,
      },
      tag: tag || undefined,
      branch: branch,
      buildTime: buildTime,
      deployment: {
        environment: environment,
        ebVersionLabel: ebVersionLabel || undefined,
      },
    };

    // Remove undefined values
    if (!versionInfo.tag) delete versionInfo.tag;
    if (!versionInfo.deployment.ebVersionLabel)
      delete versionInfo.deployment.ebVersionLabel;

    const versionJson = JSON.stringify(versionInfo, null, 2);

    // Write version.json to src directory (for development)
    const srcOutputPath = join(__dirname, "../src/version.json");
    writeFileSync(srcOutputPath, versionJson, "utf8");

    // Also write to dist directory if it exists (for production builds)
    const distOutputPath = join(__dirname, "../dist/version.json");
    const distDir = join(__dirname, "../dist");
    if (existsSync(distDir)) {
      // Ensure dist directory exists
      if (!existsSync(distDir)) {
        mkdirSync(distDir, { recursive: true });
      }
      writeFileSync(distOutputPath, versionJson, "utf8");
    }

    console.log("✅ Version information generated successfully");
    console.log(`   Version: ${packageVersion}`);
    console.log(`   Commit: ${commitShort || "unknown"}`);
    console.log(`   Branch: ${branch}`);
    if (tag) console.log(`   Tag: ${tag}`);
    console.log(`   Build Time: ${buildTime}`);
    console.log(`   Environment: ${environment}`);

    return versionInfo;
  } catch (error) {
    console.error("❌ Error generating version information:", error.message);

    // Generate fallback version info
    const packageJsonPath = join(__dirname, "../package.json");
    let packageVersion = "1.0.0";
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      packageVersion = packageJson.version || "1.0.0";
    } catch (e) {
      // Use default
    }

    const fallbackVersion = {
      version: packageVersion,
      commit: {
        short: "unknown",
        full: "unknown",
      },
      branch: "unknown",
      buildTime: new Date().toISOString(),
      deployment: {
        environment: process.env.NODE_ENV || "development",
      },
    };

    const fallbackJson = JSON.stringify(fallbackVersion, null, 2);

    // Write fallback version.json to src directory
    const srcOutputPath = join(__dirname, "../src/version.json");
    writeFileSync(srcOutputPath, fallbackJson, "utf8");

    // Also write to dist directory if it exists
    const distOutputPath = join(__dirname, "../dist/version.json");
    const distDir = join(__dirname, "../dist");
    if (existsSync(distDir)) {
      writeFileSync(distOutputPath, fallbackJson, "utf8");
    }

    console.log("⚠️  Generated fallback version information");
    return fallbackVersion;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateVersion();
}

export { generateVersion };
