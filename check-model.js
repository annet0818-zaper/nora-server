// check-model.js
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const model = process.argv[2] || "gpt-3.5-turbo";

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Ошибка: не найден ключ OPENAI_API_KEY в .env");
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

(async () => {
  console.log(`🔍 Проверяю модель: ${model} ...`);
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Привет, ты работаешь?" }],
      max_tokens: 30,
    });
    console.log(`✅ Модель '${model}' работает. Ответ: "${res.choices[0].message.content}"`);
  } catch (err) {
    if (err.status === 429 || err.message.includes("quota")) {
      console.error(`❌ Нет квоты на модель '${model}' (ошибка 429 / insufficient_quota).`);
    } else {
      console.error(`❌ Ошибка для '${model}':`, err.message);
    }
  }
})();
