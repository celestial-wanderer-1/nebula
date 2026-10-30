import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { SchemaProvider } from "../schema/SchemaProvider";
import { WsProvider } from "../ws/WsProvider";
import { ConnectionGate } from "./ConnectionGate";
import { createQueryClient } from "./queryClient";
import { routes } from "./routes";

export function App({ queryClient }: { queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <QueryClientProvider client={client}>
      <ConnectionGate>
        {(registry) => (
          <SchemaProvider registry={registry}>
            <WsProvider>
              <RouterProvider router={router} />
            </WsProvider>
          </SchemaProvider>
        )}
      </ConnectionGate>
    </QueryClientProvider>
  );
}
