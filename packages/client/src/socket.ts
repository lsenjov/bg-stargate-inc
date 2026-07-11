import {
  io,
  type ManagerOptions,
  type Socket,
  type SocketOptions,
} from "socket.io-client";

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@stargate-inc/shared";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createGameSocket(
  options?: Partial<ManagerOptions & SocketOptions>,
): GameSocket {
  const configuredUrl = (
    import.meta as ImportMeta & {
      readonly env?: { readonly VITE_SOCKET_URL?: string };
    }
  ).env?.VITE_SOCKET_URL;
  return io(configuredUrl || undefined, {
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
    timeout: 10_000,
    ...options,
  });
}
