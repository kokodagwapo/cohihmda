import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { renderWithProviders } from "@/test/render";

describe("Tabs", () => {
  it("switches visible content when a tab is selected", async () => {
    renderWithProviders(
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview content</TabsContent>
        <TabsContent value="details">Details content</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("Overview content")).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Details content")).toBeVisible();
  });
});
