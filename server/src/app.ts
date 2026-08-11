import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiRouter } from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api", apiRouter);

  // In production the client is pre-built and served as static assets by
  // this same Node process (single Render web service, no separate FE host).
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  return app;
}
