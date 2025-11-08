// index.js — Nora server (ready for Render)
// ES module style (import). Убедись, что в package.json "type":"module"
import express from "express";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const app = express();

// Настройки
app.use(express.json({ limit: "200kb" })); // можно увеличить при необходимости

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0"; // важно: слушать все интерфейсы на Render
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "*"; // по умолчанию открыто, можно задать домен

// Пре-загрузка меню (если есть) — чтобы не нагружать первый запрос
let MENU = null;
const MENU_PDF_URL = process.env.MENU_PDF_URL || "https://clubprovocateur.ru/wp-content/uploads/2025/01/menu_22-01-24.pdf";
const CRAZY_PDF_URL = process.env.CRAZY_PDF_URL || "https://clubprovocateur.ru/wp-content/uploads/2025/01/crazy_2024.pdf";

async function loadMenu() {
  try {
    const filePath = new URL("./menu.json", import.meta.url);
    const txt = await fs.readFile(filePath, "utf8");
    MENU = JSON.parse(txt);
    console.log("Menu loaded, categories:", (Array.isArray(MENU.items) && MENU.items.length) || 0);
  } catch (e) {
    MENU = null;
    console.log("No local menu.json found or failed to parse (this is OK).");
  }
}

// Простейший CORS + preflight
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  // Если нужно сузить CORS: установи ALLOWED_ORIGINS в .env на https://your-site.tilda.ws
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Health check
app.get("/", (req, res) => {
  res.type("text/plain").send("Nora dev server - ok");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

// POST /chat — минимальная логика для отладки и интеграции с воркером
app.post("/chat", async (req, res) => {
  try {
    const body = req.body || {};
    // Логируем первые N символов для отладки (не логировать секреты)
    try {
      console.log("POST /chat body:", JSON.stringify(body).slice(0, 2000));
    } catch (e) {
      console.log("POST /chat body: [unserializable]");
    }

    if (!body.message && !body.history) {
      return res.status(400).json({ error: "Нет поля message или history" });
    }

    const userMessage = String(body.message || "").trim();

    // Простейшая локальная логика: ответ-эхо или подсказка из menu
    let reply = `Эхо (dev): я получила сообщение: "${userMessage}". Это тестовый сервер.`;

    if (MENU && Array.isArray(MENU.items)) {
      // Если пользователь явно спрашивает про меню/цены, даём краткий пример
      if (/меню|цены|суши|виски|коктейл/i.test(userMessage)) {
        const first = MENU.items[0];
        if (first) {
          reply = `Посмотри пример: категория "${first.category}", позиция "${first.name}" — ${first.price || "цена не указана"}. Полное меню: ${MENU_PDF_URL}`;
        } else {
          reply = `У нас есть меню. Полный файл: ${MENU_PDF_URL}`;
        }
      }
    } else {
      // Если локального меню нет, но пользователь просит — даём ссылку на PDF
      if (/меню|цены|суши|виски|коктейл/i.test(userMessage)) {
        reply = `Полное меню в PDF: ${MENU_PDF_URL}\nCrazy-меню: ${CRAZY_PDF_URL}`;
      }
    }

    // Пример: если гость явно говорит "забронировать" — формируем шаблон для брони (без передачи менеджеру)
    if (/брон|заброниру|хочу столик|хочу бронь/i.test(userMessage)) {
      reply = `Поняла — давай соберём данные для брони: дата, время, состав (сколько человек) и зона (сцена / приват). При онлайн-броне вход бесплатный и есть подарки.`;
    }

    return res.json({ ok: true, reply });
  } catch (err) {
    console.error("Ошибка /chat:", err);
    return res.status(500).json({ error: "server error" });
  }
});

// (Опционально) endpoint для проверки, что меню доступно через API
app.get("/menu", (req, res) => {
  if (!MENU) {
    return res.status(404).json({ ok: false, error: "menu not available", menuPdf: MENU_PDF_URL });
  }
  res.json({ ok: true, menu: MENU, menuPdf: MENU_PDF_URL });
});

// Стартер: загружаем ресурсы и запускаем сервер
(async () => {
  try {
    await loadMenu();
    app.listen(PORT, HOST, () => {
      console.log(`Server listening on http://${HOST}:${PORT}`);
      console.log(`ALLOWED_ORIGINS=${ALLOWED_ORIGINS}`);
      if (process.env.OPENAI_API_KEY) console.log("OPENAI_API_KEY present in env (NOT logged).");
      else console.log("OPENAI_API_KEY not set in env.");
    });
  } catch (e) {
    console.error("Failed to start server:", e);
    process.exit(1);
  }
})();
