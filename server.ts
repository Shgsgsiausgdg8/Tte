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
    }, 500);
    ws.on("close", () => clearInterval(interval));
  });

  app.use(express.json());
  app.get("/api/bot/status", (req, res) => res.json(bot.getState()));
  app.post("/api/bot/toggle", (req, res) => {
    bot.isTrading = !bot.isTrading;
    res.json({ status: bot.isTrading });
  });
  app.post("/api/bot/manual-trade", async (req, res) => {
    const { action } = req.body;
    if (action === 'BUY' || action === 'SELL') {
      const signal = bot.createSmartSignal(action);
      await bot.enterTrade(signal);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  });
  app.post("/api/bot/close-all", async (req, res) => {
    const promises = Array.from(bot.openPositions.keys()).map(id => bot.closeTrade(id, 'manual_close_all'));
    await Promise.all(promises);
    res.json({ success: true });
  });
  app.get("/api/bot/settings", (req, res) => res.json(bot.settings));
  app.post("/api/bot/settings", (req, res) => {
    bot.saveSettings(req.body);
    res.json({ success: true });
  });
  app.post("/api/bot/reset-stats", (req, res) => {
    bot.dailyPnL = 0;
    bot.totalTrades = 0;
    bot.winningTrades = 0;
    bot.losingTrades = 0;
    bot.closedPositions = [];
    bot.saveState();
    res.json({ success: true });
  });
  app.post("/api/bot/restart", (req, res) => {
    // Restart the bot engine
    bot.connectToExternalWS();
    res.json({ success: true });
  });

  app.post("/api/bot/autotune", async (req, res) => {
    try {
      // Backup current settings before optimization
      bot.backupSettings();

      // Trigger optimization manually
      const at = bot.settings.autoTune || {};
      const inFile = at.marketFile || path.join(process.cwd(), 'logs/market.jsonl');
      const outFile = at.bestParamsFile || path.join(process.cwd(), 'logs/best_params.json');
      const iters = Number(at.iterations || 80);

      const { runOptimization } = await import('./src/server/optimizer');
      const result = await runOptimization(inFile, outFile, iters);

      if (at.autoApply) {
        const { loadBestParams } = await import('./src/server/autotuneManager');
        loadBestParams(bot.settings, outFile);
      }

      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/bot/autotune/results", (req, res) => {
    try {
      const at = bot.settings.autoTune || {};
      const outFile = at.bestParamsFile || path.join(process.cwd(), 'logs/best_params.json');
      if (fs.existsSync(outFile)) {
        const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        res.json(data);
      } else {
        res.status(404).json({ error: 'No results found' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post("/api/bot/restore-settings", (req, res) => {
    const success = bot.restoreSettings();
    res.json({ success });
  });

  app.post("/api/bot/create-portfolio", async (req, res) => {
    const { units } = req.body;
    if (!units || units <= 0) {
      return res.status(400).json({ success: false, message: 'تعداد واحد نامعتبر است' });
    }
    const result = await bot.createPortfolio(units);
    res.json(result);
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    bot.start().catch(console.error);
  });
}

startServer();
