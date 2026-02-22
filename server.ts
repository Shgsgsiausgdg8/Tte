import express from "express";
import http from "http";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { FarazGoldBot } from "./src/server/bot";

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  const bot = new FarazGoldBot();
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: 'INIT', data: bot.getState() }));
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'UPDATE', data: bot.getState() }));
      }
    }, 1000);
    ws.on("close", () => clearInterval(interval));
  });

  app.use(express.json());
  app.get("/api/bot/status", (req, res) => res.json(bot.getState()));
  app.post("/api/bot/toggle", (req, res) => {
    bot.isTrading = !bot.isTrading;
    res.json({ status: bot.isTrading });
  });
  app.get("/api/bot/settings", (req, res) => res.json(bot.settings));
  app.post("/api/bot/settings", (req, res) => {
    bot.saveSettings(req.body);
    res.json({ success: true });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    bot.start().catch(console.error);
  });
}

startServer();
