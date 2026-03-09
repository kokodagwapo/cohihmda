import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { renderWithProviders } from "@/test/render";

describe("Switch and Checkbox", () => {
  it("toggles switch checked state", async () => {
    renderWithProviders(<Switch aria-label="Enable alerts" />);
    const toggle = screen.getByRole("switch", { name: "Enable alerts" });

    expect(toggle).toHaveAttribute("data-state", "unchecked");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("data-state", "checked");
  });

  it("toggles checkbox checked state", async () => {
    renderWithProviders(<Checkbox aria-label="Accept terms" />);
    const checkbox = screen.getByRole("checkbox", { name: "Accept terms" });

    expect(checkbox).toHaveAttribute("data-state", "unchecked");
    await userEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("data-state", "checked");
  });
});
