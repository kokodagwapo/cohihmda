import { describe, it, expect } from "vitest";
import { mergeDatasetUploadIds } from "./uploadConversationService.js";

describe("uploadConversationService", () => {
  it("mergeDatasetUploadIds prefers datasetUploadIds and merges research.uploadIds", () => {
    const ids = mergeDatasetUploadIds({
      options: {
        datasetUploadIds: ["550e8400-e29b-41d4-a716-446655440001"],
        research: {
          uploadIds: ["550e8400-e29b-41d4-a716-446655440002"],
        },
      },
    });
    expect(ids).toHaveLength(2);
    expect(ids).toContain("550e8400-e29b-41d4-a716-446655440001");
    expect(ids).toContain("550e8400-e29b-41d4-a716-446655440002");
  });

  it("mergeDatasetUploadIds dedupes", () => {
    const id = "550e8400-e29b-41d4-a716-446655440001";
    const ids = mergeDatasetUploadIds({
      options: {
        datasetUploadIds: [id],
        research: { uploadIds: [id] },
      },
    });
    expect(ids).toEqual([id]);
  });
});
