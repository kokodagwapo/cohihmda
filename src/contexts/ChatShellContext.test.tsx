import { beforeEach, describe, it, expect } from "vitest";

import { render, screen } from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import { MemoryRouter, Routes, Route, Link } from "react-router-dom";

import {

  ChatShellProvider,

  useChatShell,

  cohiChatResumeNavigationState,

} from "./ChatShellContext";



function InsightsPage() {

  const { mode, setMode } = useChatShell();

  return (

    <div>

      <div data-testid="mode">{mode}</div>

      <button type="button" onClick={() => setMode("full")}>

        Full

      </button>

      <button type="button" onClick={() => setMode("split")}>

        Split

      </button>

      <button type="button" onClick={() => setMode("tall")}>

        Tall

      </button>

      <Link to="/loans">Loans</Link>

      <Link to="/loans" state={cohiChatResumeNavigationState()}>

        Loans resume

      </Link>

    </div>

  );

}



function LoansPage() {

  const { mode } = useChatShell();

  return (

    <div>

      <div data-testid="mode">{mode}</div>

      <Link to="/insights">Insights</Link>

    </div>

  );

}



describe("ChatShellProvider", () => {

  beforeEach(() => {

    Object.defineProperty(window, "matchMedia", {

      writable: true,

      value: (query: string) => ({

        matches: false,

        media: query,

        onchange: null,

        addListener: () => {},

        removeListener: () => {},

        addEventListener: () => {},

        removeEventListener: () => {},

        dispatchEvent: () => false,

      }),

    });

  });



  it("persists compact/tall/split across navigation; full collapses on route change", async () => {

    const user = userEvent.setup();



    render(

      <MemoryRouter initialEntries={["/insights"]}>

        <ChatShellProvider>

          <Routes>

            <Route path="/insights" element={<InsightsPage />} />

            <Route path="/loans" element={<LoansPage />} />

          </Routes>

        </ChatShellProvider>

      </MemoryRouter>,

    );



    expect(screen.getByTestId("mode")).toHaveTextContent("compact");



    await user.click(screen.getByRole("button", { name: "Split" }));

    await user.click(screen.getByRole("link", { name: "Loans" }));

    expect(screen.getByTestId("mode")).toHaveTextContent("split");



    await user.click(screen.getByRole("link", { name: "Insights" }));

    await user.click(screen.getByRole("button", { name: "Tall" }));

    await user.click(screen.getByRole("link", { name: "Loans" }));

    expect(screen.getByTestId("mode")).toHaveTextContent("tall");



    await user.click(screen.getByRole("link", { name: "Insights" }));

    await user.click(screen.getByRole("button", { name: "Full" }));

    await user.click(screen.getByRole("link", { name: "Loans" }));

    expect(screen.getByTestId("mode")).toHaveTextContent("compact");

  });



  it("forces full mode when resuming a historical chat", async () => {

    const user = userEvent.setup();



    render(

      <MemoryRouter initialEntries={["/insights"]}>

        <ChatShellProvider>

          <Routes>

            <Route path="/insights" element={<InsightsPage />} />

            <Route path="/loans" element={<LoansPage />} />

          </Routes>

        </ChatShellProvider>

      </MemoryRouter>,

    );



    await user.click(screen.getByRole("button", { name: "Split" }));

    await user.click(screen.getByRole("link", { name: "Loans resume" }));

    expect(screen.getByTestId("mode")).toHaveTextContent("full");

  });

});


