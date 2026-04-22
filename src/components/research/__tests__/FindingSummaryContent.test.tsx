import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { FindingSummaryContent } from "@/components/research/FindingSummaryContent";

describe("FindingSummaryContent", () => {
  it("renders list for long multi-sentence summary", () => {
    const summary =
      "Pipeline aged inventory remains elevated. 475 of 1,086 active loans are older than 180 days (43.74%). Aged volume totals $108.7M.";
    renderWithProviders(<FindingSummaryContent summary={summary} />);

    const list = screen.getByRole("list");
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(1);
  });

  it("renders paragraph for short single sentence", () => {
    renderWithProviders(<FindingSummaryContent summary="Pipeline hygiene improved this week." />);
    expect(screen.getByText("Pipeline hygiene improved this week.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("uses preferred bullets when provided", () => {
    renderWithProviders(
      <FindingSummaryContent
        summary="Ignored because preferred bullets are present."
        preferredBullets={["First", "Second"]}
      />
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });
});
