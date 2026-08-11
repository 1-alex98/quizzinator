import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./protocol.js";

type QuizSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: QuizSocket | undefined;

// Single shared connection with built-in reconnection/back-off, reused by
// whichever view mounts first. Socket.IO falls back to HTTP long-polling
// when a websocket upgrade fails, which is what makes this resilient on
// flaky venue wifi (see "fault tolerant" requirement) across Safari/Chrome.
export function getSocket(): QuizSocket {
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
