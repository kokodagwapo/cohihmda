import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ROLE_MATRIX } from "./roleMatrix.js";

function extractMountedApiPaths(fileContent: string): string[] {
  const matches = [...fileContent.matchAll(/app\.use\("([^"]+)",/g)];
  return matches
    .map((m) => m[1])
    .filter((p) => p.startsWith("/api"))
    .sort();
}

function isCoveredByMatrix(mountedPath: string, routeGroups: Set<string>): boolean {
  for (const group of routeGroups) {
    if (
      mountedPath === group ||
      mountedPath.startsWith(`${group}/`) ||
      group.startsWith(`${mountedPath}/`)
    ) {
      return true;
    }
  }
  return false;
}

describe("Route matrix coverage", () => {
  it("covers all API mount points in setupRoutes", () => {
    const routesIndexPath = path.resolve(process.cwd(), "src/routes/index.ts");
    const routesSource = fs.readFileSync(routesIndexPath, "utf8");
    const mountedPaths = extractMountedApiPaths(routesSource);
    const matrixGroups = new Set(ROLE_MATRIX.map((r) => r.routeGroup));

    const uncovered = mountedPaths.filter((p) => !isCoveredByMatrix(p, matrixGroups));
    expect(uncovered).toEqual([]);
  });
});
