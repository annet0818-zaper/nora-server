// index.js — Nora server (Render / Node 22+)
import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";

globalThis.fetch = fetch;

dotenv.config();

const app = express();
app.use(express.json({ limit: "300kb" }));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const MENU_PDF_URL =
  process.env.MENU_PDF_URL ||
  "https://clubprovocateur.ru/wp-content/uploads/2025/01/menu_22-01-24.pdf";

const CRAZY_PDF_URL =
  process.env.CRAZY_PDF_URL ||
  "https://clubprovocateur.ru/wp-content/uploads/2025/01/crazy_2024.pdf";

/**
 * CORS (под Тильду и сайт)
 */
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  else res.setHeader("Access-Control-Allow-Origin", "*");

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "false");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

/**
 * Tilda -> Server -> Make
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { message, isNewSession = false, sessionId, history } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required (string)" });
    }
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "sessionId is required (string)" });
    }

    const makeUrl = process.env.MAKE_WEBHOOK_URL;
    const makeKey = process.env.MAKE_API_KEY;

    if (!makeUrl || !makeKey) {
      return res.status(500).json({ error: "MAKE_WEBHOOK_URL / MAKE_API_KEY not set" });
    }

    // таймаут
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000); // 20 сек

    const r = await fetch(makeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-make-apikey": makeKey,
      },
      body: JSON.stringify({
        message,
        isNewSession: !!isNewSession,
        sessionId,
        history: typeof history === "string" ? history.slice(0, 12000) : "",
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));

    const text = await r.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({
        error: "Make returned non-JSON",
        status: r.status,
        raw: text,
      });
    }

    // добавим PDF ссылки, если Make попросил
    if (data.sendPdf === "menu" || data.sendPdf === "both") {
      data.menuPdfUrl = MENU_PDF_URL;
    }
    if (data.sendPdf === "crazy" || data.sendPdf === "both") {
      data.crazyPdfUrl = CRAZY_PDF_URL;
    }

    return res.status(200).json(data);
  } catch (err) {
    if (String(err).includes("AbortError")) {
      return res.status(504).json({ error: "Timeout calling Make" });
    }
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
