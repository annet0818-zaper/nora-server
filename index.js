import express from "express";
import dotenv from "dotenv";
import fs from "fs/promises";

dotenv.config();

const app = express();
app.use(express.json({ limit: "200kb" }));

const PORT = process.env.PORT || 3000;

// Простейший health
app.get("/", (req, res) => res.send("Nora dev server - ok"));

// POST /chat — минимальная логика для отладки
app.post("/chat", async (req, res) => {
  try {
    const body = req.body || {};
    console.log("POST /chat body:", JSON.stringify(body).slice(0, 2000));

    if (!body.message && !body.history) {
      return res.status(400).json({ error: "Нет поля message или history" });
    }

    const userMessage = String(body.message || "").trim();

    // Пример: если есть локальное menu.json — подгружаем (необязательно)
    let menu = null;
    try {
      const txt = await fs.readFile(new URL('./menu.json', import.meta.url), 'utf8');
      menu = JSON.parse(txt);
    } catch (e) {
      // без menu.json нормально — просто логируем
    }

    // Заглушка-ответ: эхо +, при наличии меню — даём короткую подсказку
    let reply = `Эхо (dev): я получила сообщение: "${userMessage}". Это тестовый сервер.`;

    if (menu && Array.isArray(menu.items) && /меню|суши|цены/i.test(userMessage)) {
      reply = `Я вижу, у нас есть меню. Например, категория "${menu.items[0].category}" — первая позиция "${menu.items[0].name}" (${menu.items[0].price || 'цена не указана'}). Полное меню: ${process.env.MENU_PDF_URL || 'ссылка не задана'}.`;
    }

    return res.json({ ok: true, reply });
  } catch (err) {
    console.error("Ошибка /chat:", err);
    return res.status(500).json({ error: "server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
