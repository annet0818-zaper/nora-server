// index.js — Nora server (Render / Node 22+)
// Роль сервера: Tilda -> Server -> Make (OpenAI внутри Make)
// PROMPT из сервера удалён: единый источник — prompt_nora.txt в Make.

import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "200kb" }));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "*";

const MENU_PDF_URL =
  process.env.MENU_PDF_URL ||
  "https://clubprovocateur.ru/wp-content/uploads/2025/01/menu_22-01-24.pdf";

const CRAZY_PDF_URL =
  process.env.CRAZY_PDF_URL ||
  "https://clubprovocateur.ru/wp-content/uploads/2025/01/crazy_2024.pdf";

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const MAKE_API_KEY = process.env.MAKE_API_KEY;

const HISTORY_MAX_MESSAGES = Number(process.env.HISTORY_MAX_MESSAGES || 16); // user+assistant
const MAKE_TIMEOUT_MS = Number(process.env.MAKE_TIMEOUT_MS || 15000);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 6 * 60 * 60 * 1000); // 6 часов

// ---------------- CORS ----------------
function parseAllowedOrigins(value) {
  if (!value) return { allowAll: true, list: [] };
  const raw = String(value).trim();
  if (raw === "*" || raw.toLowerCase() === "all") return { allowAll: true, list: [] };
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { allowAll: false, list };
}

const ORIGINS = parseAllowedOrigins(ALLOWED_ORIGINS);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (ORIGINS.allowAll) {
    // Для браузера — лучше отражать origin, чем "*"
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    else res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    if (origin && ORIGINS.list.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
  }

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "false");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------------- Health ----------------
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

// ---------------- Chat Memory (in-memory) ----------------
/**
 * sessionId -> { messages: [{role, content, ts}], lastSeen }
 */
const sessions = new Map();

function resetSession(sessionId) {
  sessions.set(sessionId, { messages: [], lastSeen: Date.now() });
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) resetSession(sessionId);
  const s = sessions.get(sessionId);
  s.lastSeen = Date.now();
  return s;
}

function pushMsg(sessionId, role, content) {
  const s = getSession(sessionId);
  s.messages.push({
    role,
    content: String(content ?? ""),
    ts: Date.now(),
  });

  if (s.messages.length > HISTORY_MAX_MESSAGES) {
    s.messages = s.messages.slice(s.messages.length - HISTORY_MAX_MESSAGES);
  }
}

function formatHistory(session) {
  // компактный формат для промпта в Make
  return session.messages
    .map((m) => `${m.role === "user" ? "USER" : "NORA"}: ${m.content}`)
    .join("\n");
}

// Чистим старые сессии, чтобы память не росла бесконечно
setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions.entries()) {
    if (now - (s.lastSeen || 0) > SESSION_TTL_MS) sessions.delete(sid);
  }
}, 30 * 60 * 1000);

// ---------------- Helpers ----------------
function asStringOrEmpty(v) {
  return v === null || v === undefined ? "" : String(v);
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x === null || x === undefined ? "" : String(x)))
    .filter((x) => x.trim().length > 0);
}

function normalizeMakeResponse(data) {
  const bookingDraft = data?.bookingDraft || {};
  const safe = {
    reply: asStringOrEmpty(data?.reply) || "…",
    intent: asStringOrEmpty(data?.intent) || "other",
    sendPdf: asStringOrEmpty(data?.sendPdf) || "none",
    needHuman: Boolean(data?.needHuman),
    quickReplies: asStringArray(data?.quickReplies),
    bookingDraft: {
      date: asStringOrEmpty(bookingDraft?.date),
      time: asStringOrEmpty(bookingDraft?.time),
      party: asStringOrEmpty(bookingDraft?.party),
      zone: asStringOrEmpty(bookingDraft?.zone),
    },
  };

  // Добавим PDF-ссылки, если Make попросил
  if (safe.sendPdf === "menu" || safe.sendPdf === "both") safe.menuPdfUrl = MENU_PDF_URL;
  if (safe.sendPdf === "crazy" || safe.sendPdf === "both") safe.crazyPdfUrl = CRAZY_PDF_URL;

  // Гарантия: никаких null/undefined наружу
  if (!safe.quickReplies) safe.quickReplies = [];
  if (!safe.bookingDraft) {
    safe.bookingDraft = { date: "", time: "", party: "", zone: "" };
  }

  return safe;
}

// ---------------- Main endpoint: Tilda -> Server -> Make ----------------
app.post("/api/chat", async (req, res) => {
  try {
    const { message, isNewSession = false, sessionId } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required (string)" });
    }
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "sessionId is required (string)" });
    }

    if (!MAKE_WEBHOOK_URL || !MAKE_API_KEY) {
      return res
        .status(500)
        .json({ error: "MAKE_WEBHOOK_URL / MAKE_API_KEY not set" });
    }

    // NEW SESSION => очищаем историю
    if (isNewSession === true) resetSession(sessionId);

    // Пишем сообщение пользователя в историю
    pushMsg(sessionId, "user", message);

    const session = getSession(sessionId);
    const chatHistory = formatHistory(session);

    // Таймаут, чтобы запрос не зависал
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), MAKE_TIMEOUT_MS);

    const r = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-make-apikey": MAKE_API_KEY,
      },
      body: JSON.stringify({
        message,
        isNewSession: Boolean(isNewSession),
        sessionId,
        chatHistory, // 👈 ключевое: память диалога
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));

    const raw = await r.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({
        error: "Make returned non-JSON",
        status: r.status,
        raw,
      });
    }

    const safe = normalizeMakeResponse(data);

    // Записываем ответ Норы в историю
    pushMsg(sessionId, "assistant", safe.reply);

    return res.status(200).json(safe);
  } catch (err) {
    if (String(err).includes("AbortError")) {
      return res.status(504).json({ error: "Timeout calling Make" });
    }
    console.error("Server error /api/chat:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
});

// ---------------- Start ----------------
app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
  console.log(`ALLOWED_ORIGINS=${ALLOWED_ORIGINS}`);
  console.log(`HISTORY_MAX_MESSAGES=${HISTORY_MAX_MESSAGES}`);
  console.log(`MAKE_TIMEOUT_MS=${MAKE_TIMEOUT_MS}`);
});
