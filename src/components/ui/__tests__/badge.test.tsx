import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";
import { renderWithProviders } from "@/test/render";

describe("Badge", () => {
  it("renders content", () => {
    renderWithProviders(<Badge>Stable</Badge>);
    expect(screen.getByText("Stable")).toBeInTheDocument();
  });
});
