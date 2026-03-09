import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@/components/ui/input";
import { renderWithProviders } from "@/test/render";

describe("Input", () => {
  it("accepts user input", async () => {
    renderWithProviders(<Input aria-label="Email" />);

    const input = screen.getByRole("textbox", { name: "Email" });
    await userEvent.type(input, "qa@coheus.test");
    expect(input).toHaveValue("qa@coheus.test");
  });
});
