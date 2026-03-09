import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { renderWithProviders } from "@/test/render";

describe("Alert", () => {
  it("renders title and description", () => {
    renderWithProviders(
      <Alert>
        <AlertTitle>Deployment blocked</AlertTitle>
        <AlertDescription>Playwright image version mismatch detected.</AlertDescription>
      </Alert>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Deployment blocked")).toBeInTheDocument();
    expect(screen.getByText("Playwright image version mismatch detected.")).toBeInTheDocument();
  });
});
