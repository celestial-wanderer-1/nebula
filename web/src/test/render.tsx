import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { setTypeRegistry } from "../api/registry";
import { setTokenForTesting } from "../api/token";
import { routes } from "../app/routes";
import { mockSchema } from "../mocks/fixtures";
import { MOCK_TOKEN } from "../mocks/token";
import { SchemaProvider } from "../schema/SchemaProvider";
import { WsProvider } from "../ws/WsProvider";

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** The providers a connected app has, around arbitrary content. */
export function Connected({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SchemaProvider registry={mockSchema}>
        <WsProvider>{children}</WsProvider>
      </SchemaProvider>
    </QueryClientProvider>
  );
}

/** Connects with the mock token, as if the launch URL had been opened. */
export function connect(): void {
  setTokenForTesting(MOCK_TOKEN);
  setTypeRegistry(mockSchema.typeRegistry);
}

export function renderConnected(ui: ReactElement) {
  connect();
  const queryClient = testQueryClient();
  return {
    queryClient,
    ...render(<Connected queryClient={queryClient}>{ui}</Connected>),
  };
}

/** Renders the routed app at `path`, past the connection gate. */
export function renderRoute(path: string) {
  connect();
  const queryClient = testQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return {
    queryClient,
    router,
    ...render(
      <Connected queryClient={queryClient}>
        <RouterProvider router={router} />
      </Connected>,
    ),
  };
}
