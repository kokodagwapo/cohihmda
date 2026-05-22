import { describe, it, expect, vi } from "vitest";
import {
  mergeDatasetUploadIds,
  resolveDatasetUploadIdsForRequest,
} from "./uploadConversationService.js";

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

  it("resolveDatasetUploadIdsForRequest merges conversation-linked uploads", async () => {
    const convId = "550e8400-e29b-41d4-a716-446655440099";
    const linkedId = "550e8400-e29b-41d4-a716-446655440088";
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("research_upload_conversation_links")) {
          return { rows: [{ upload_id: linkedId }] };
        }
        return { rows: [] };
      }),
    } as unknown as import("pg").Pool;

    const ids = await resolveDatasetUploadIdsForRequest(
      { conversationId: convId, options: {} },
      pool,
    );
    expect(ids).toEqual([linkedId]);
  });
});
