// index.js — Nora server (Render / Node 22+)
import express from "express";
import dotenv from "dotenv";
import fs from "fs/promises";
import fetch from "node-fetch";

globalThis.fetch = fetch; // стабильный fetch в Node

dotenv.config();

const app = express();
app.use(express.json({ limit: "200kb" }));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "*";

const MENU_PDF_URL = process.env.MENU_PDF_URL || "https://clubprovocateur.ru/wp-content/uploads/2025/01/menu_22-01-24.pdf";
const CRAZY_PDF_URL = process.env.CRAZY_PDF_URL || "https://clubprovocateur.ru/wp-content/uploads/2025/01/crazy_2024.pdf";

const SYSTEM_BOOST =
  "Ты — Нора, AI-консультант клуба Provocateur.\n" +
  "Твоя задача:\n" +
  "- Отвечать дружелюбно, живо и \"человечно\".\n" +
  "- Давать рекомендации по меню (используй меню из menu.json).\n" +
  "- Если спрашивают о подарках — предлагай актуальные акции.\n" +
  "- Всегда приветливая и лёгкая в общении.\n" +
  "- Не генерируй ошибки и не упоминай внутренние тестовые режимы.\n" +
  "- Приветствуй гостей клуба позитивно и приветливо.\n";

let MENU = null;

// Загрузка локального меню
async function loadMenu() {
  try {
    const filePath = new URL("./menu.json", import.meta.url);
    const txt = await fs.readFile(filePath, "utf8");
    MENU = JSON.parse(txt);
    console.log("Menu loaded, items:", (Array.isArray(MENU.items) && MENU.items.length) || 0);
  } catch {
    MENU = null;
    console.log("No local menu.json found or failed to parse (OK).");
  }
}

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Health
app.get("/", (req, res) => res.type("text/plain").send("Nora dev server - ok"));
app.get("/health", (req, res) => res.json({ ok: true, status: "healthy" }));

// CHAT — один чистый обработчик
app.post("/chat", async (req, res) => {
  try {
    const body = req.body || {};
    const userMessage = String(body.message || "").trim();

    if (!userMessage && !Array.isArray(body.history)) {
      return res.status(400).json({ ok: false, error: "Нет поля message или history" });
    }

    // Короткий контекст меню (БЕЗ шаблонных строк)
    let menuSnippet = "";
    if (MENU && Array.isArray(MENU.items) && MENU.items.length > 0) {
      const sample = MENU.items.slice(0, 5).map(i =>
        (i.category ? i.category + ": " : "") +
        (i.name || "") +
        (i.price ? " — " + i.price : "")
      );
      menuSnippet = "Пример меню: " + sample.join("; ") + ". Полное меню: " + MENU_PDF_URL + ".";
    } else {
      menuSnippet = "Полное меню: " + MENU_PDF_URL + ". Crazy-меню: " + CRAZY_PDF_URL + ".";
    }

    // Параметры LLM
    const USE_OPENAI = process.env.USE_OPENAI !== "false"; // по умолчанию true
    const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // Попытка ответа через OpenAI
    let reply = "";
    if (USE_OPENAI) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000); // 20s

        const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + (process.env.OPENAI_API_KEY || "")
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
              { role: "system", content: SYSTEM_BOOST },
              { role: "system", content: "Контекст меню: " + menuSnippet },
              { role: "user", content: userMessage }
            ],
            max_tokens: 600,
            temperature: 0.7,
            n: 1
          }),
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (openaiResponse.ok) {
          const data = await openaiResponse.json();
          const m = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          reply = (m && String(m).trim()) || "";
        } else if (openaiResponse.status === 429) {
          console.warn("OpenAI quota exceeded (429). Falling back.");
        } else {
          const text = await openaiResponse.text();
          console.error("OpenAI API non-OK:", openaiResponse.status, text);
        }
      } catch (e) {
        console.error("OpenAI fetch error (network/timeout):", e && e.name, e && e.message);
      }
    }

    // Fallback локальный (если из LLM ничего не пришло)
    if (!reply) {
      reply = "Эхо (dev): я получила сообщение: \"" + userMessage + "\". Это тестовый сервер.";

      if (/брон|заброниру|хочу столик|хочу бронь/i.test(userMessage)) {
        reply = "Поняла — давай соберём данные для брони: дата, время, состав (кол-во гостей) и желаемая зона (сцена / приват). При онлайн-броне вход бесплатный и есть подарки.";
      } else if (/меню|цены|суши|виски|коктейл/i.test(userMessage)) {
        if (MENU && Array.isArray(MENU.items) && MENU.items.length > 0) {
          const first = MENU.items[0];
          reply = first
            ? "Пример: категория \"" + (first.category || "") + "\", позиция \"" + (first.name || "") + "\" — " + (first.price || "цена не указана") + ". Полное меню: " + MENU_PDF_URL
            : "Полное меню: " + MENU_PDF_URL;
        } else {
          reply = "Полное меню в PDF: " + MENU_PDF_URL + "\nCrazy-меню: " + CRAZY_PDF_URL;
        }
      }
    }

    console.log("Reply length:", reply.length);
    return res.json({ ok: true, reply });
  } catch (err) {
    console.error("Ошибка /chat:", err);
    return res.status(500).json({ ok: false, error: "server error", detail: err && err.message });
  }
});

// MENU
app.get("/menu", (req, res) => {
  if (!MENU) return res.status(404).json({ ok: false, error: "menu not available", menuPdf: MENU_PDF_URL });
  return res.json({ ok: true, menu: MENU, menuPdf: MENU_PDF_URL });
});

// START
(async () => {
  try {
    await loadMenu();
    app.listen(PORT, HOST, () => {
      console.log("Server listening on http://" + HOST + ":" + PORT);
      console.log("ALLOWED_ORIGINS=" + ALLOWED_ORIGINS);
      if (process.env.OPENAI_API_KEY) console.log("OPENAI_API_KEY present in env (not logged).");
      else console.log("OPENAI_API_KEY not set in env.");
    });
  } catch (e) {
    console.error("Failed to start server:", e);
    process.exit(1);
  }
})();
