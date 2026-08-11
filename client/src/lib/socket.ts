import { io, type Socket } from "socket.io-client";

let socket: Socket | undefined;

// Single shared connection with built-in reconnection/back-off, reused by
// whichever view mounts first. Socket.IO falls back to HTTP long-polling
// when a websocket upgrade fails, which is what makes this resilient on
// flaky venue wifi (see "fault tolerant" requirement) across Safari/Chrome.
export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}
