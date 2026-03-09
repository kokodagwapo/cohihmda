import { ReactElement, ReactNode } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type ExtendedRenderOptions = Omit<RenderOptions, "wrapper"> & {
  route?: string;
  withRouter?: boolean;
};

export function renderWithProviders(ui: ReactElement, options: ExtendedRenderOptions = {}) {
  const { route = "/", withRouter = false, ...renderOptions } = options;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    if (!withRouter) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    return (
      <MemoryRouter initialEntries={[route]}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
