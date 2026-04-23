import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { screen, waitFor } from "@testing-library/react";
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

vi.mock("@/components/layout/TopTieringLayout", () => ({
  TopTieringLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="top-tiering-layout">{children}</div>
  ),
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
    sessionStorage.clear();
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

  it("autofills dashboards area and leaderboard description prefix from route state", async () => {
    renderWithProviders(<FeedbackPage />, {
      withRouter: true,
      initialEntries: [
        {
          pathname: "/feedback",
          state: { sourcePath: "/leaderboard", sourceSearch: "" },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Dashboards");
    });
    expect(screen.getByLabelText("Description")).toHaveValue("Leaderboard - ");
  });

  it("autofills insights area without description prefix", async () => {
    renderWithProviders(<FeedbackPage />, {
      withRouter: true,
      initialEntries: [
        {
          pathname: "/feedback",
          state: { sourcePath: "/insights", sourceSearch: "" },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Insights");
    });
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("autofills workbench area without description prefix for a specific my-dashboard page", async () => {
    renderWithProviders(<FeedbackPage />, {
      withRouter: true,
      initialEntries: [
        {
          pathname: "/feedback",
          state: { sourcePath: "/my-dashboard/Canvas-123", sourceSearch: "" },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Workbench");
    });
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("autofills dashboards area and loan detail prefix from loan-detail route", async () => {
    renderWithProviders(<FeedbackPage />, {
      withRouter: true,
      initialEntries: [
        {
          pathname: "/feedback",
          state: { sourcePath: "/loan-detail", sourceSearch: "" },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Dashboards");
    });
    expect(screen.getByLabelText("Description")).toHaveValue("Loan Detail - ");
  });

  it("autofills dashboards area and loan-detail loan id prefix when query has loan", async () => {
    renderWithProviders(<FeedbackPage />, {
      withRouter: true,
      initialEntries: [
        {
          pathname: "/feedback",
          state: { sourcePath: "/loan-detail", sourceSearch: "?loan=LN-12345" },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Dashboards");
    });
    expect(screen.getByLabelText("Description")).toHaveValue("Loan Detail LN-12345 - ");
  });

  it("autofills dashboards area and fallback prefix for fallout forecast loan route", async () => {
    renderWithProviders(<FeedbackPage />, {
      withRouter: true,
      initialEntries: [
        {
          pathname: "/feedback",
          state: { sourcePath: "/fallout-forecast/loan/ABC-99", sourceSearch: "" },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Dashboards");
    });
    expect(screen.getByLabelText("Description")).toHaveValue("Fallout Forecast Loan ABC-99 - ");
  });

  it("autofills dashboards area for loans page", async () => {
    renderWithProviders(<FeedbackPage />, {
      withRouter: true,
      initialEntries: [
        {
          pathname: "/feedback",
          state: { sourcePath: "/loans", sourceSearch: "" },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Dashboards");
    });
  });

  it("autofills research area without description prefix for a specific research session", async () => {
    renderWithProviders(<FeedbackPage />, {
      withRouter: true,
      initialEntries: [
        {
          pathname: "/feedback",
          state: { sourcePath: "/research/session", sourceSearch: "?session=Session-1" },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Research Lab");
    });
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("restores saved draft and does not overwrite it with autofill", async () => {
    sessionStorage.setItem(
      "feedback:draft:default",
      JSON.stringify({
        area: "communication_center",
        type: "question",
        description: "Draft feedback already started",
      }),
    );

    renderWithProviders(<FeedbackPage />, {
      withRouter: true,
      initialEntries: [
        {
          pathname: "/feedback",
          state: { sourcePath: "/leaderboard", sourceSearch: "" },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Communication Center");
    });
    expect(screen.getByLabelText("Description")).toHaveValue("Draft feedback already started");
  });

  it("clears persisted draft after successful submit", async () => {
    createFeedbackMock.mockResolvedValue({
      feedback: { id: "fb-1" },
      notificationSent: true,
      notificationFailures: [],
    });
    sessionStorage.setItem(
      "feedback:draft:default",
      JSON.stringify({
        area: "dashboards",
        type: "bug_issue",
        description: "Leaderboard - Draft to submit",
      }),
    );

    renderWithProviders(<FeedbackPage />, { withRouter: true, route: "/feedback" });
    await userEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));

    await waitFor(() => {
      expect(createFeedbackMock).toHaveBeenCalledTimes(1);
    });
    expect(sessionStorage.getItem("feedback:draft:default")).toBeNull();
  });

  it("clears persisted draft when user clicks clear", async () => {
    sessionStorage.setItem(
      "feedback:draft:default",
      JSON.stringify({
        area: "workbench",
        type: "feature_request",
        description: "Workbench - Draft to clear",
      }),
    );

    renderWithProviders(<FeedbackPage />, { withRouter: true, route: "/feedback" });
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(sessionStorage.getItem("feedback:draft:default")).toBeNull();
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("shows max file count validation when more than 5 files are selected", async () => {
    renderWithProviders(<FeedbackPage />, { withRouter: true, route: "/feedback" });

    const fileInput = screen.getByLabelText("Attachments (optional)") as HTMLInputElement;
    const files = Array.from({ length: 6 }).map(
      (_, i) => new File([`row-${i}`], `sample-${i}.csv`, { type: "text/csv" }),
    );
    await userEvent.upload(fileInput, files);

    expect(await screen.findByText("Maximum 5 files allowed")).toBeInTheDocument();
  });

  it("keeps submit enabled when only max-file warning is shown", async () => {
    renderWithProviders(<FeedbackPage />, { withRouter: true, route: "/feedback" });

    const fileInput = screen.getByLabelText("Attachments (optional)") as HTMLInputElement;
    const files = Array.from({ length: 6 }).map(
      (_, i) => new File([`row-${i}`], `sample-${i}.csv`, { type: "text/csv" }),
    );
    await userEvent.upload(fileInput, files);

    const submitButton = screen.getByRole("button", { name: "Submit Feedback" });
    expect(submitButton).toBeEnabled();
  });

  it("shows oversized image validation message", async () => {
    renderWithProviders(<FeedbackPage />, { withRouter: true, route: "/feedback" });

    const fileInput = screen.getByLabelText("Attachments (optional)") as HTMLInputElement;
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });
    await userEvent.upload(fileInput, oversized);

    expect(await screen.findByText(/File is too large:/)).toBeInTheDocument();
    expect(createFeedbackMock).not.toHaveBeenCalled();
  });

  it("appends newly selected attachments instead of replacing existing ones", async () => {
    renderWithProviders(<FeedbackPage />, { withRouter: true, route: "/feedback" });

    const fileInput = screen.getByLabelText("Attachments (optional)") as HTMLInputElement;
    const excel = new File(["a,b\n1,2"], "report.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const screenshot = new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", {
      type: "image/png",
    });

    await userEvent.upload(fileInput, excel);
    expect(await screen.findByText("report.xlsx")).toBeInTheDocument();

    await userEvent.upload(fileInput, screenshot);
    expect(await screen.findByText("report.xlsx")).toBeInTheDocument();
    expect(await screen.findByText("screenshot.png")).toBeInTheDocument();
  });
});
