import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../app.js";
import { createRealtimeServer } from "../realtime.js";
import type {
  AckResponse,
  ClientToServerEvents,
  PlayerJoinAck,
  QuestionRevealedPayload,
  ServerToClientEvents,
  StateSyncPayload,
} from "../protocol.js";

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function waitForEvent<E extends keyof ServerToClientEvents>(
  socket: Client,
  event: E,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => {
    socket.once(event, resolve as never);
  });
}

function emitAck<E extends keyof ClientToServerEvents>(
  socket: Client,
  event: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
): Promise<AckResponse<unknown>> {
  return new Promise((resolve) => {
    // @ts-expect-error -- generic emit signature doesn't narrow per-event across the union
    socket.emit(event, payload, resolve);
  });
}

describe("quiz engine", () => {
  let baseUrl: string;
  let httpServer: ReturnType<typeof createServer>;
  const app = createApp();

  beforeAll(async () => {
    httpServer = createServer(app);
    createRealtimeServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function connect(): Client {
    return ioClient(baseUrl, { forceNew: true, transports: ["websocket"] });
  }

  async function createLobby(questions: unknown[]) {
    const created = await request(app).post("/api/sessions");
    const sessionId = created.body.id as string;
    const code = created.body.code as string;
    await request(app)
      .put(`/api/sessions/${sessionId}/question-set`)
      .send({ id: "set-1", title: "Test set", questions })
      .expect(200);
    return { sessionId, code };
  }

  const numberQuestions = [
    {
      id: "q1",
      type: "number",
      prompt: "How many?",
      points: 100,
      timeLimitSec: 30,
      min: 0,
      max: 100,
      step: 1,
      correctValue: 50,
    },
    {
      id: "q2",
      type: "number",
      prompt: "How many again?",
      points: 100,
      timeLimitSec: 30,
      min: 0,
      max: 100,
      step: 1,
      correctValue: 10,
    },
  ];

  it("runs a full lobby -> question -> reveal -> ended flow", async () => {
    const { sessionId, code } = await createLobby(numberQuestions);

    const host = connect();
    const player = connect();
    await Promise.all([waitForEvent(host, "connect" as never), waitForEvent(player, "connect" as never)]);

    const hostAck = await emitAck(host, "host:join", { sessionId });
    expect(hostAck.ok).toBe(true);
    expect((hostAck as { ok: true; data: StateSyncPayload }).data.state).toBe("lobby");

    const hostSawJoin = waitForEvent(host, "state:sync");
    const joinAck = (await emitAck(player, "player:join", { code, name: "Alice" })) as AckResponse<PlayerJoinAck>;
    expect(joinAck.ok).toBe(true);
    const playerId = (joinAck as { ok: true; data: PlayerJoinAck }).data.playerId;

    const syncAfterJoin = await hostSawJoin;
    expect(syncAfterJoin.players).toHaveLength(1);
    expect(syncAfterJoin.players[0]).toMatchObject({ name: "Alice", connected: true });

    const hostSawQuestion = waitForEvent(host, "question:show");
    const playerSawQuestion = waitForEvent(player, "question:show");
    const startAck = await emitAck(host, "session:start", { sessionId });
    expect(startAck.ok).toBe(true);

    const [hostQuestion, playerQuestion] = await Promise.all([hostSawQuestion, playerSawQuestion]);
    expect(hostQuestion.index).toBe(0);
    expect(hostQuestion.question).not.toHaveProperty("correctValue");
    expect(playerQuestion.question.id).toBe("q1");

    const progress = waitForEvent(host, "question:progress");
    const answerAck = await emitAck(player, "answer:submit", { sessionId, playerId, value: 50 });
    expect(answerAck).toEqual({ ok: true, data: { score: 100, correct: true } });
    expect(await progress).toEqual({ answered: 1, total: 1 });

    // Submitting twice for the same question is rejected.
    const duplicateAck = await emitAck(player, "answer:submit", { sessionId, playerId, value: 10 });
    expect(duplicateAck).toEqual({ ok: false, error: "already_answered" });

    const revealed = waitForEvent(player, "question:revealed") as Promise<QuestionRevealedPayload>;
    const revealAck = await emitAck(host, "question:reveal", { sessionId });
    expect(revealAck.ok).toBe(true);
    const revealPayload = await revealed;
    expect(revealPayload.results).toEqual([
      { playerId, value: 50, score: 100, correct: true, totalScore: 100 },
    ]);
    expect(revealPayload.leaderboard[0]).toMatchObject({ id: playerId, score: 100 });

    const nextQuestion = waitForEvent(host, "question:show");
    const nextAck = await emitAck(host, "question:next", { sessionId });
    expect(nextAck.ok).toBe(true);
    expect((await nextQuestion).question.id).toBe("q2");

    await emitAck(player, "answer:submit", { sessionId, playerId, value: 10 });
    const secondReveal = waitForEvent(host, "question:revealed");
    await emitAck(host, "question:reveal", { sessionId });
    await secondReveal;

    const ended = waitForEvent(host, "session:ended");
    const finalNextAck = await emitAck(host, "question:next", { sessionId });
    expect(finalNextAck.ok).toBe(true);
    const endedPayload = await ended;
    expect(endedPayload.players[0]).toMatchObject({ id: playerId, score: 200 });

    host.disconnect();
    player.disconnect();
  });

  it("rejects host-only commands from non-host sockets", async () => {
    const { sessionId } = await createLobby(numberQuestions);
    const impostor = connect();
    await waitForEvent(impostor, "connect" as never);

    const ack = await emitAck(impostor, "session:start", { sessionId });
    expect(ack).toEqual({ ok: false, error: "not_host" });

    impostor.disconnect();
  });

  it("refuses to start a lobby with no question set", async () => {
    const created = await request(app).post("/api/sessions");
    const sessionId = created.body.id as string;

    const host = connect();
    await waitForEvent(host, "connect" as never);
    await emitAck(host, "host:join", { sessionId });

    const ack = await emitAck(host, "session:start", { sessionId });
    expect(ack).toEqual({ ok: false, error: "no_question_set" });

    host.disconnect();
  });

  it("keeps a reconnecting player's identity and score", async () => {
    const { sessionId, code } = await createLobby(numberQuestions);

    const host = connect();
    await waitForEvent(host, "connect" as never);
    await emitAck(host, "host:join", { sessionId });

    let player = connect();
    await waitForEvent(player, "connect" as never);
    const joinAck = (await emitAck(player, "player:join", { code, name: "Bob" })) as AckResponse<PlayerJoinAck>;
    const playerId = (joinAck as { ok: true; data: PlayerJoinAck }).data.playerId;

    const questionShown = waitForEvent(player, "question:show");
    await emitAck(host, "session:start", { sessionId });
    await questionShown;
    await emitAck(player, "answer:submit", { sessionId, playerId, value: 50 });

    const revealed = waitForEvent(host, "question:revealed");
    await emitAck(host, "question:reveal", { sessionId });
    await revealed;

    const disconnectSync = waitForEvent(host, "state:sync");
    player.disconnect();
    const afterDisconnect = await disconnectSync;
    expect(afterDisconnect.players[0]).toMatchObject({ id: playerId, connected: false, score: 100 });

    player = connect();
    await waitForEvent(player, "connect" as never);
    const reconnectSync = waitForEvent(host, "state:sync");
    const rejoinAck = (await emitAck(player, "player:join", {
      code,
      name: "Bob",
      playerId,
    })) as AckResponse<PlayerJoinAck>;
    expect(rejoinAck).toEqual({ ok: true, data: { playerId, sessionId, state: "reveal" } });

    const afterReconnect = await reconnectSync;
    expect(afterReconnect.players[0]).toMatchObject({ id: playerId, connected: true, score: 100 });
    expect(afterReconnect.players).toHaveLength(1);

    host.disconnect();
    player.disconnect();
  });

  it("auto-reveals once the server-driven timer runs out", async () => {
    const { sessionId } = await createLobby([{ ...numberQuestions[0], timeLimitSec: 1.2 }]);

    const host = connect();
    await waitForEvent(host, "connect" as never);
    await emitAck(host, "host:join", { sessionId });

    const tick = waitForEvent(host, "timer:tick");
    const revealed = waitForEvent(host, "question:revealed");
    await emitAck(host, "session:start", { sessionId });

    const tickPayload = await tick;
    expect(tickPayload.remainingSec).toBeGreaterThanOrEqual(0);
    const revealPayload = await revealed;
    expect(revealPayload.results).toEqual([]);

    host.disconnect();
  }, 5000);
});
