import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";

// Thin bootstrap for the realtime layer. The actual quiz state machine
// (join, start-question, submit-answer, reveal, timer sync, reconnect
// handling) is built out in the "Realtime quiz engine" issue — this just
// wires the transport so TV and mobile clients have something to connect to.
export function createRealtimeServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    socket.on("disconnect", () => {
      // Reconnect / grace-period handling arrives with the quiz engine.
    });
  });

  return io;
}
