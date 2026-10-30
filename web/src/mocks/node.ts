import { setupServer } from "msw/node";
import { restHandlers } from "./handlers";
import { wsHandlers } from "./ws";

export const server = setupServer(...restHandlers, ...wsHandlers);
