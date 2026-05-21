import { describe, it, expect } from "vitest";
import {
  parseWorkbenchLlmJson,
  repairWorkbenchBlocks,
  workbenchStreamDisplayText,
  looksLikeWorkbenchJsonBlob,
} from "./parseWorkbenchLlmJson";

const SAMPLE = {
  message: "I'll create two visuals from your uploaded trial balance.",
  actions: [
    { type: "create_widget", title: "Top 5", sql: "SELECT 1" },
  ],
  teachingNotes: "Revenue from 4000-series accounts.",
  suggestedQuestions: ["Add labels?"],
};

describe("parseWorkbenchLlmJson", () => {
  it("parses plain JSON", () => {
    const raw = JSON.stringify(SAMPLE);
    const p = parseWorkbenchLlmJson(raw);
    expect(p?.message).toBe(SAMPLE.message);
    expect(p?.actions).toHaveLength(1);
  });

  it("parses duplicated JSON objects (LLM double emit)", () => {
    const raw = JSON.stringify(SAMPLE) + JSON.stringify(SAMPLE);
    const p = parseWorkbenchLlmJson(raw);
    expect(p?.message).toBe(SAMPLE.message);
    expect(p?.actions).toHaveLength(1);
  });

  it("parses fenced JSON", () => {
    const raw = "```json\n" + JSON.stringify(SAMPLE) + "\n```";
    const p = parseWorkbenchLlmJson(raw);
    expect(p?.message).toBe(SAMPLE.message);
  });
});

describe("repairWorkbenchBlocks", () => {
  it("splits a single text blob into text + actions", () => {
    const blob = JSON.stringify(SAMPLE);
    const { blocks, suggestedQuestions } = repairWorkbenchBlocks([
      { type: "text", markdown: blob },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: "text",
      markdown: SAMPLE.message,
    });
    expect(blocks[1]?.type).toBe("actions");
    expect(suggestedQuestions).toEqual(SAMPLE.suggestedQuestions);
  });
});

describe("workbenchStreamDisplayText", () => {
  it("shows human message instead of raw JSON when payload is complete", () => {
    const raw = JSON.stringify(SAMPLE);
    expect(looksLikeWorkbenchJsonBlob(raw)).toBe(true);
    expect(workbenchStreamDisplayText(raw)).toBe(SAMPLE.message);
  });

  it("shows placeholder for incomplete JSON blob", () => {
    expect(workbenchStreamDisplayText('{"message":"x","actions":[')).toBe(
      "Working on your request…",
    );
  });
});
