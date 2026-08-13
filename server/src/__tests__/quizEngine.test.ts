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
    const hostToken = created.body.hostToken as string;
    await request(app)
      .put(`/api/sessions/${sessionId}/question-set`)
      .send({ id: "set-1", title: "Test set", questions })
      .expect(200);
    return { sessionId, code, hostToken };
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

  it("runs a full lobby -> question -> reveal -> ended flow, auto-revealing once every connected player has answered", async () => {
    const { sessionId, code, hostToken } = await createLobby(numberQuestions);

    const host = connect();
    const alice = connect();
    const bob = connect();
    await Promise.all([
      waitForEvent(host, "connect" as never),
      waitForEvent(alice, "connect" as never),
      waitForEvent(bob, "connect" as never),
    ]);

    const hostAck = await emitAck(host, "host:join", { sessionId, hostToken });
    expect(hostAck.ok).toBe(true);
    expect((hostAck as { ok: true; data: StateSyncPayload }).data.state).toBe("lobby");

    const hostSawAliceJoin = waitForEvent(host, "state:sync");
    const aliceJoinAck = (await emitAck(alice, "player:join", { code, name: "Alice" })) as AckResponse<PlayerJoinAck>;
    expect(aliceJoinAck.ok).toBe(true);
    const alicePlayerId = (aliceJoinAck as { ok: true; data: PlayerJoinAck }).data.playerId;
    await hostSawAliceJoin;

    const hostSawBobJoin = waitForEvent(host, "state:sync");
    const bobJoinAck = (await emitAck(bob, "player:join", { code, name: "Bob" })) as AckResponse<PlayerJoinAck>;
    expect(bobJoinAck.ok).toBe(true);
    const bobPlayerId = (bobJoinAck as { ok: true; data: PlayerJoinAck }).data.playerId;
    const syncAfterBobJoin = await hostSawBobJoin;
    expect(syncAfterBobJoin.players).toHaveLength(2);

    const hostSawQuestion = waitForEvent(host, "question:show");
    const aliceSawQuestion = waitForEvent(alice, "question:show");
    const bobSawQuestion = waitForEvent(bob, "question:show");
    const startAck = await emitAck(host, "session:start", { sessionId });
    expect(startAck.ok).toBe(true);

    const [hostQuestion, aliceQuestion] = await Promise.all([hostSawQuestion, aliceSawQuestion, bobSawQuestion]);
    expect(hostQuestion.index).toBe(0);
    expect(hostQuestion.question).not.toHaveProperty("correctValue");
    expect(aliceQuestion.question.id).toBe("q1");

    const firstProgress = waitForEvent(host, "question:progress");
    const aliceAnswerAck = await emitAck(alice, "answer:submit", { sessionId, playerId: alicePlayerId, value: 50 });
    expect(aliceAnswerAck).toEqual({ ok: true, data: { score: 100, correct: true } });
    expect(await firstProgress).toEqual({ answered: 1, total: 2 });

    // Submitting twice for the same question is rejected while still waiting on Bob.
    const duplicateAck = await emitAck(alice, "answer:submit", { sessionId, playerId: alicePlayerId, value: 10 });
    expect(duplicateAck).toEqual({ ok: false, error: "already_answered" });

    // Once the last connected player answers, the question reveals
    // immediately - no manual question:reveal needed.
    const revealed = waitForEvent(host, "question:revealed") as Promise<QuestionRevealedPayload>;
    const bobAnswerAck = await emitAck(bob, "answer:submit", { sessionId, playerId: bobPlayerId, value: 0 });
    expect(bobAnswerAck).toEqual({ ok: true, data: { score: 50, correct: false } });
    const revealPayload = await revealed;
    expect(revealPayload.results).toEqual(
      expect.arrayContaining([
        { playerId: alicePlayerId, value: 50, score: 100, correct: true, totalScore: 100 },
        { playerId: bobPlayerId, value: 0, score: 50, correct: false, totalScore: 50 },
      ]),
    );
    expect(revealPayload.leaderboard[0]).toMatchObject({ id: alicePlayerId, score: 100 });

    const nextQuestion = waitForEvent(host, "question:show");
    const nextAck = await emitAck(host, "question:next", { sessionId });
    expect(nextAck.ok).toBe(true);
    expect((await nextQuestion).question.id).toBe("q2");

    // Only Alice answers this time, so the question waits for a manual reveal.
    const secondProgress = waitForEvent(host, "question:progress");
    await emitAck(alice, "answer:submit", { sessionId, playerId: alicePlayerId, value: 10 });
    expect(await secondProgress).toEqual({ answered: 1, total: 2 });

    const secondReveal = waitForEvent(host, "question:revealed");
    const secondRevealAck = await emitAck(host, "question:reveal", { sessionId });
    expect(secondRevealAck.ok).toBe(true);
    await secondReveal;

    const ended = waitForEvent(host, "session:ended");
    const finalNextAck = await emitAck(host, "question:next", { sessionId });
    expect(finalNextAck.ok).toBe(true);
    const endedPayload = await ended;
    expect(endedPayload.players.find((p) => p.id === alicePlayerId)).toMatchObject({ score: 200 });
    expect(endedPayload.players.find((p) => p.id === bobPlayerId)).toMatchObject({ score: 50 });

    host.disconnect();
    alice.disconnect();
    bob.disconnect();
  });

  it("includes a computed distanceKm in geo reveal results", async () => {
    const geoQuestions = [
      {
        id: "q-geo",
        type: "geo",
        prompt: "Where?",
        points: 100,
        timeLimitSec: 30,
        correctLat: 52.52,
        correctLng: 13.405,
        maxDistanceKm: 100,
      },
    ];
    const { sessionId, code, hostToken } = await createLobby(geoQuestions);

    const host = connect();
    const player = connect();
    await Promise.all([waitForEvent(host, "connect" as never), waitForEvent(player, "connect" as never)]);
    await emitAck(host, "host:join", { sessionId, hostToken });
    const joinAck = (await emitAck(player, "player:join", { code, name: "Alice" })) as AckResponse<PlayerJoinAck>;
    const playerId = (joinAck as { ok: true; data: PlayerJoinAck }).data.playerId;

    const playerSawQuestion = waitForEvent(player, "question:show");
    await emitAck(host, "session:start", { sessionId });
    await playerSawQuestion;

    // The lone connected player answering triggers an automatic reveal.
    const revealed = waitForEvent(host, "question:revealed") as Promise<QuestionRevealedPayload>;
    await emitAck(player, "answer:submit", { sessionId, playerId, value: { lat: 52.0, lng: 13.405 } });
    const revealPayload = await revealed;

    expect(revealPayload.results[0].distanceKm).toBeCloseTo(57.85, 0);

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

  it("rejects host:join with a missing or wrong hostToken", async () => {
    const { sessionId, hostToken } = await createLobby(numberQuestions);
    const impostor = connect();
    await waitForEvent(impostor, "connect" as never);

    const wrongTokenAck = await emitAck(impostor, "host:join", { sessionId, hostToken: "wrong-token" });
    expect(wrongTokenAck).toEqual({ ok: false, error: "not_host" });

    // Knowing the sessionId still isn't enough to then run host-only commands.
    const startAck = await emitAck(impostor, "session:start", { sessionId });
    expect(startAck).toEqual({ ok: false, error: "not_host" });

    const correctAck = await emitAck(impostor, "host:join", { sessionId, hostToken });
    expect(correctAck.ok).toBe(true);

    impostor.disconnect();
  });

  it("refuses to start a lobby with no question set", async () => {
    const created = await request(app).post("/api/sessions");
    const sessionId = created.body.id as string;
    const hostToken = created.body.hostToken as string;

    const host = connect();
    await waitForEvent(host, "connect" as never);
    await emitAck(host, "host:join", { sessionId, hostToken });

    const ack = await emitAck(host, "session:start", { sessionId });
    expect(ack).toEqual({ ok: false, error: "no_question_set" });

    host.disconnect();
  });

  it("keeps a reconnecting player's identity and score", async () => {
    const { sessionId, code, hostToken } = await createLobby(numberQuestions);

    const host = connect();
    await waitForEvent(host, "connect" as never);
    await emitAck(host, "host:join", { sessionId, hostToken });

    let player = connect();
    await waitForEvent(player, "connect" as never);
    const joinAck = (await emitAck(player, "player:join", { code, name: "Bob" })) as AckResponse<PlayerJoinAck>;
    const playerId = (joinAck as { ok: true; data: PlayerJoinAck }).data.playerId;

    const questionShown = waitForEvent(player, "question:show");
    await emitAck(host, "session:start", { sessionId });
    await questionShown;

    // The lone connected player answering triggers an automatic reveal.
    const revealed = waitForEvent(host, "question:revealed");
    await emitAck(player, "answer:submit", { sessionId, playerId, value: 50 });
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
    expect(rejoinAck).toEqual({
      ok: true,
      data: { playerId, sessionId, state: "reveal", answered: false },
    });

    const afterReconnect = await reconnectSync;
    expect(afterReconnect.players[0]).toMatchObject({ id: playerId, connected: true, score: 100 });
    expect(afterReconnect.players).toHaveLength(1);

    host.disconnect();
    player.disconnect();
  });

  // A phone that drops mid-question (iOS screen lock) reconnects on a brand
  // new socket and repeats player:join. The ack is the only message that new
  // socket gets, so it has to carry enough to rebuild the answer screen.
  it("hands a player rejoining mid-question the in-flight question and whether they already answered", async () => {
    const { sessionId, code, hostToken } = await createLobby(numberQuestions);

    const host = connect();
    await waitForEvent(host, "connect" as never);
    await emitAck(host, "host:join", { sessionId, hostToken });

    // Two players so one can drop without triggering the "everyone answered"
    // auto-reveal and ending the question under test.
    let alice = connect();
    const bob = connect();
    await Promise.all([waitForEvent(alice, "connect" as never), waitForEvent(bob, "connect" as never)]);
    const aliceJoin = (await emitAck(alice, "player:join", { code, name: "Alice" })) as AckResponse<PlayerJoinAck>;
    const aliceId = (aliceJoin as { ok: true; data: PlayerJoinAck }).data.playerId;
    await emitAck(bob, "player:join", { code, name: "Bob" });

    const questionShown = waitForEvent(alice, "question:show");
    await emitAck(host, "session:start", { sessionId });
    await questionShown;

    // Drops before answering: back on the answer screen, still able to answer.
    alice.disconnect();
    alice = connect();
    await waitForEvent(alice, "connect" as never);
    const beforeAnswering = (await emitAck(alice, "player:join", {
      code,
      name: "Alice",
      playerId: aliceId,
    })) as AckResponse<PlayerJoinAck>;
    expect(beforeAnswering).toMatchObject({
      ok: true,
      data: { state: "question", answered: false, question: { index: 0, question: { id: "q1" } } },
    });

    // Drops after answering: must not be offered a second attempt.
    await emitAck(alice, "answer:submit", { sessionId, playerId: aliceId, value: 42 });
    alice.disconnect();
    alice = connect();
    await waitForEvent(alice, "connect" as never);
    const afterAnswering = (await emitAck(alice, "player:join", {
      code,
      name: "Alice",
      playerId: aliceId,
    })) as AckResponse<PlayerJoinAck>;
    expect(afterAnswering).toMatchObject({ ok: true, data: { state: "question", answered: true } });

    host.disconnect();
    alice.disconnect();
    bob.disconnect();
  });

  it("auto-reveals based on connected players only, ignoring a disconnected player", async () => {
    const { sessionId, code, hostToken } = await createLobby(numberQuestions);

    const host = connect();
    await waitForEvent(host, "connect" as never);
    await emitAck(host, "host:join", { sessionId, hostToken });

    const alice = connect();
    await waitForEvent(alice, "connect" as never);
    const aliceJoinAck = (await emitAck(alice, "player:join", { code, name: "Alice" })) as AckResponse<PlayerJoinAck>;
    const alicePlayerId = (aliceJoinAck as { ok: true; data: PlayerJoinAck }).data.playerId;

    const bob = connect();
    await waitForEvent(bob, "connect" as never);
    await emitAck(bob, "player:join", { code, name: "Bob" });

    const questionShown = waitForEvent(alice, "question:show");
    await emitAck(host, "session:start", { sessionId });
    await questionShown;

    const disconnectSync = waitForEvent(host, "state:sync");
    bob.disconnect();
    await disconnectSync;

    // Bob left, so Alice is now the only connected player - her answer alone
    // should be enough to trigger the reveal, without waiting for Bob.
    const revealed = waitForEvent(host, "question:revealed");
    await emitAck(alice, "answer:submit", { sessionId, playerId: alicePlayerId, value: 50 });
    await revealed;

    host.disconnect();
    alice.disconnect();
  });

  it("auto-reveals once the server-driven timer runs out", async () => {
    const { sessionId, hostToken } = await createLobby([{ ...numberQuestions[0], timeLimitSec: 1.2 }]);

    const host = connect();
    await waitForEvent(host, "connect" as never);
    await emitAck(host, "host:join", { sessionId, hostToken });

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
