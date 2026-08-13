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
    watchVisibility(socket);
  }
  return socket;
}

/**
 * Locking an iPhone (or switching apps) suspends timers in the background
 * tab, so Socket.IO's reconnection back-off can be frozen mid-cycle while
 * the transport is already dead. The socket then sits there disconnected
 * long after the phone is unlocked. Nudging it the moment the page becomes
 * visible again turns a multi-second (or indefinite) stall into an
 * immediate reconnect.
 */
function watchVisibility(target: QuizSocket): void {
  if (typeof document === "undefined") return;
  const reconnectIfNeeded = () => {
    if (document.visibilityState === "visible" && target.disconnected) {
      target.connect();
    }
  };
  document.addEventListener("visibilitychange", reconnectIfNeeded);
  window.addEventListener("focus", reconnectIfNeeded);
  window.addEventListener("pageshow", reconnectIfNeeded);
}

/**
 * Runs `rejoin` on every (re)connection, including the current one if the
 * socket is already connected. Both the host and player clients need this:
 * a reconnected socket is a brand new socket id on the server, so it is no
 * longer in the session's room and no longer registered as the host/player
 * until it repeats its join handshake. Returns an unsubscribe function.
 */
export function onReconnect(target: QuizSocket, rejoin: () => void): () => void {
  target.on("connect", rejoin);
  if (target.connected) rejoin();
  return () => {
    target.off("connect", rejoin);
  };
}
