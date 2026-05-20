import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createUnifiedChatFolder,
  moveUnifiedChatFolder,
  MAX_FOLDER_DEPTH,
} from "./unifiedChatFolderService.js";

const queryMock = vi.fn();

vi.mock("../../config/tenantDatabaseManager.js", () => ({
  tenantDbManager: {
    getTenantPool: vi.fn(async () => ({
      query: queryMock,
    })),
  },
}));

describe("unifiedChatFolderService", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("CREATE TABLE")) return { rows: [] };
      if (sql.includes("SELECT depth FROM")) {
        return { rows: [{ depth: 5 }] };
      }
      if (sql.includes("INSERT INTO")) {
        return {
          rows: [
            {
              id: "f1",
              user_id: "u1",
              parent_id: "p1",
              name: "Child",
              depth: 6,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it("rejects folder creation beyond max depth", async () => {
    await expect(
      createUnifiedChatFolder({
        tenantId: "t1",
        userId: "u1",
        name: "Too deep",
        parentId: "p1",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(MAX_FOLDER_DEPTH).toBe(5);
  });

  it("rejects moving a folder into its own subfolder", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("CREATE TABLE")) return { rows: [] };
      if (sql.includes("FROM public.unified_chat_folders\n    WHERE user_id")) {
        return {
          rows: [
            {
              id: "parent",
              user_id: "u1",
              parent_id: null,
              name: "Parent",
              depth: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            {
              id: "child",
              user_id: "u1",
              parent_id: "parent",
              name: "Child",
              depth: 2,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes("WHERE id = $1::uuid AND user_id = $2::uuid") && sql.includes("SELECT id, user_id")) {
        return {
          rows: [
            {
              id: "parent",
              user_id: "u1",
              parent_id: null,
              name: "Parent",
              depth: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      moveUnifiedChatFolder({
        tenantId: "t1",
        userId: "u1",
        folderId: "parent",
        parentId: "child",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
