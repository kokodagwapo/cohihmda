import { describe, expect, it } from "vitest";
import { presentationExportPrefilter } from "@/lib/presentationExportIntent";

describe("presentationExportPrefilter (client)", () => {
  it("matches required token vocabulary", () => {
    expect(presentationExportPrefilter("Make a slideshow of this")).toBe(true);
    expect(presentationExportPrefilter("power point deck please")).toBe(true);
    expect(presentationExportPrefilter("slide deck for the board")).toBe(true);
    expect(presentationExportPrefilter("put that into slides")).toBe(true);
    expect(presentationExportPrefilter("export as ppt")).toBe(true);
    expect(presentationExportPrefilter("keynote style deck")).toBe(true);
    expect(presentationExportPrefilter("make a slide show")).toBe(true);
    expect(presentationExportPrefilter("board presentation")).toBe(true);
    expect(presentationExportPrefilter("pptx export")).toBe(true);
  });

  it("misses unrelated analytics questions", () => {
    expect(presentationExportPrefilter("What is pull-through?")).toBe(false);
    expect(presentationExportPrefilter("show funded units YTD")).toBe(false);
  });
});
