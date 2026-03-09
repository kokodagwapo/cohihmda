import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { renderWithProviders } from "@/test/render";

describe("Card", () => {
  it("renders all card sections", () => {
    renderWithProviders(
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Status</CardTitle>
          <CardDescription>All checks are green</CardDescription>
        </CardHeader>
        <CardContent>82 passed</CardContent>
        <CardFooter>Updated just now</CardFooter>
      </Card>,
    );

    expect(screen.getByText("Pipeline Status")).toBeInTheDocument();
    expect(screen.getByText("All checks are green")).toBeInTheDocument();
    expect(screen.getByText("82 passed")).toBeInTheDocument();
    expect(screen.getByText("Updated just now")).toBeInTheDocument();
  });
});
