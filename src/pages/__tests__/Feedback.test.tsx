import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedbackPage from "@/pages/Feedback";
import { renderWithProviders } from "@/test/render";

const { createFeedbackMock, getFeedbackListMock, toastMock } = vi.hoisted(() => ({
  createFeedbackMock: vi.fn(),
  getFeedbackListMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/components/layout/Navigation", () => ({
  Navigation: () => <div data-testid="navigation" />,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isSuperAdmin: () => false,
  }),
}));

vi.mock("@/stores/tenantStore", () => ({
  useTenantStore: () => ({
    selectedTenantId: null,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createFeedback: createFeedbackMock,
    getFeedbackList: getFeedbackListMock,
  },
}));

describe("FeedbackPage", () => {
  beforeEach(() => {
    createFeedbackMock.mockReset();
    getFeedbackListMock.mockReset();
    toastMock.mockReset();
    getFeedbackListMock.mockResolvedValue({
      feedback: [],
      page: 1,
      limit: 50,
      total: 0,
    });
  });

  it("shows required field errors and blocks submit", async () => {
    renderWithProviders(<FeedbackPage />, { withRouter: true, route: "/feedback" });

    await userEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));

    expect(await screen.findByText("Area is required to submit")).toBeInTheDocument();
    expect(await screen.findByText("Description is required to submit")).toBeInTheDocument();
    expect(createFeedbackMock).not.toHaveBeenCalled();
  });
});
