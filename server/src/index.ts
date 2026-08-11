import { createServer } from "node:http";
import { createApp } from "./app.js";
import { createRealtimeServer } from "./realtime.js";

const port = Number(process.env.PORT ?? 3001);

const app = createApp();
const httpServer = createServer(app);
createRealtimeServer(httpServer);

httpServer.listen(port, () => {
  console.log(`quizzinator server listening on :${port}`);
});
