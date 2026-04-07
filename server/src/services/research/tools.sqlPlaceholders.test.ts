import { describe, it, expect } from "vitest";
import { maxPgPlaceholderIndex } from "./tools.js";

describe("maxPgPlaceholderIndex", () => {
  it("returns 0 when there are no placeholders", () => {
    expect(maxPgPlaceholderIndex("SELECT 1 AS x")).toBe(0);
  });

  it("returns the highest $n index", () => {
    expect(maxPgPlaceholderIndex("SELECT $1, $2, $3")).toBe(3);
    expect(maxPgPlaceholderIndex("WHERE a = $2 AND b = $1")).toBe(2);
  });
});
