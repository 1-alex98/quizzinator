import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { registerQuizEngine } from "./quizEngine.js";
import type { ClientToServerEvents, ServerToClientEvents } from "./protocol.js";

// Transport bootstrap: creates the Socket.IO server and hands it to the
// quiz engine, which owns the join/start/answer/reveal event protocol and
// the session state machine.
export function createRealtimeServer(httpServer: HttpServer): Server<ClientToServerEvents, ServerToClientEvents> {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: "*" },
  });

  registerQuizEngine(io);

  return io;
}
