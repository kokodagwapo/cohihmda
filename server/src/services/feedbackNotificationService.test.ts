import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, sendEmailMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sendEmailMock: vi.fn(),
}));

vi.mock("../config/managementDatabase.js", () => ({
  pool: {
    query: queryMock,
  },
}));

vi.mock("./emailService.js", () => ({
  sendEmail: sendEmailMock,
}));

import {
  notifySuperAdminsOfFeedback,
  resolveActiveSuperAdminEmails,
} from "./feedbackNotificationService.js";

describe("feedbackNotificationService", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendEmailMock.mockReset();
  });

  it("resolves active super admin emails from management DB", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { email: "admin1@coheus.test" },
        { email: "ADMIN1@coheus.test" },
        { email: "admin2@coheus.test" },
      ],
    });

    const emails = await resolveActiveSuperAdminEmails();

    expect(queryMock).toHaveBeenCalledOnce();
    expect(emails).toEqual(["admin1@coheus.test", "admin2@coheus.test"]);
  });

  it("retries failed recipient email sends once", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ email: "admin1@coheus.test" }, { email: "admin2@coheus.test" }],
    });

    sendEmailMock.mockImplementation(({ to }: { to: string }) => {
      if (to === "admin2@coheus.test" && sendEmailMock.mock.calls.length === 2) {
        throw new Error("Temporary provider failure");
      }
      return Promise.resolve(undefined);
    });

    const result = await notifySuperAdminsOfFeedback({
      feedbackId: "b50379fc-411f-4cf6-a4f1-1f190e67b467",
      area: "bugs",
      description: "Description",
      submitterEmail: "user@coheus.test",
      submitterUserId: "8b47d380-0702-4ab8-b83a-2a7f8e474e65",
      tenantId: "9e4f79c8-4a66-43ad-9d83-93881ca89e66",
      tenantName: "Tenant",
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(3);
    expect(result.sent).toContain("admin1@coheus.test");
    expect(result.sent).toContain("admin2@coheus.test");
    expect(result.failed).toHaveLength(0);
  });
});
