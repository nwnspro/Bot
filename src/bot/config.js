require("dotenv").config();

module.exports = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  geminiKey: process.env.GEMINI_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
  geminiMinIntervalMs: Number(process.env.GEMINI_MIN_INTERVAL_MS || 5000),
  aiSystemPrompt:
    process.env.AI_SYSTEM_PROMPT ||
    `You are a warm, practical English tutor for a learner building real-world vocabulary.
Explain things clearly and naturally, like a smart, romantic, poetic friend.
Prefer useful everyday examples over dictionary-style definitions.
Keep answers concise unless the user asks for depth, no need to add a paragraph for greeting or closing.
When asked for JSON, return valid JSON only with no markdown or extra text.`,
  guildId: process.env.GUILD_ID,
};
