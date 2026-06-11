const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI;
let model;
let queue = Promise.resolve();
let lastRequestAt = 0;

class GeminiQuotaError extends Error {
	constructor(message) {
		super(message);
		this.name = 'GeminiQuotaError';
		this.isGeminiQuotaError = true;
	}
}

function getModel() {
	if (!genAI) {
		const { geminiKey } = require('../config');
		if (!geminiKey) {
			throw new Error('Gemini API key is missing. Set GEMINI_KEY in your .env file.');
		}
		genAI = new GoogleGenerativeAI(geminiKey);
	}
	if (!model) {
		const { aiSystemPrompt, geminiModel } = require('../config');
		model = genAI.getGenerativeModel({
			model: geminiModel,
			systemInstruction: aiSystemPrompt,
		});
	}
	return model;
}

function stripJson(text) {
	return text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDurationMs(value) {
	if (!value || typeof value !== 'string') return null;

	const match = value.match(/^(\d+(?:\.\d+)?)s$/);
	return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

function getRetryDelayMs(err) {
	const retryInfo = err?.errorDetails?.find(detail =>
		detail?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo',
	);
	const retryDelayMs = parseDurationMs(retryInfo?.retryDelay);
	if (retryDelayMs) return retryDelayMs;

	const retryAfter = err?.response?.headers?.get?.('retry-after');
	const retryAfterSeconds = Number(retryAfter);
	if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
		return retryAfterSeconds * 1000;
	}

	return null;
}

function isRetryableGeminiError(err) {
	const status = err?.status || err?.response?.status;
	return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isHardQuotaError(err) {
	if ((err?.status || err?.response?.status) !== 429) return false;

	const message = err?.message || '';
	return message.includes('limit: 0') || message.includes('check your plan and billing details');
}

async function runWithGeminiThrottle(task) {
	const run = queue.then(async () => {
		const { geminiMinIntervalMs } = require('../config');
		const elapsed = Date.now() - lastRequestAt;
		if (elapsed < geminiMinIntervalMs) {
			await sleep(geminiMinIntervalMs - elapsed);
		}

		lastRequestAt = Date.now();
		return task();
	});

	queue = run.catch(() => undefined);
	return run;
}

async function generateContentWithRetry(prompt) {
	const maxAttempts = 4;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await runWithGeminiThrottle(() => getModel().generateContent(prompt));
		}
		catch (err) {
			if (isHardQuotaError(err)) {
				throw new GeminiQuotaError('Gemini quota is exhausted or disabled for this API key/project. Check billing, quota, or switch GEMINI_MODEL/API key.');
			}

			if (!isRetryableGeminiError(err) || attempt === maxAttempts) {
				throw err;
			}

			const retryDelayMs = getRetryDelayMs(err);
			const backoffMs = retryDelayMs || Math.min(30000, 1000 * 2 ** (attempt - 1));
			console.warn(`[gemini] Retryable error (${err.status || err.response?.status || 'unknown'}). Retrying in ${backoffMs}ms...`);
			await sleep(backoffMs);
		}
	}
}

function getFriendlyGeminiError(err) {
	if (err?.isGeminiQuotaError) {
		return 'Gemini connected, but this API key/project has no available quota right now. Check Gemini billing/quota, or try another API key/model.';
	}
	return 'The AI request failed. Please try again.';
}

async function enrichWords(words) {
	const prompt = `For each English word below, provide a clear practical explanation (like a smart friend explaining it, not a dictionary definition), IPA pronunciation, and 2 natural example sentences showing real-world usage.

Words: ${words.join(', ')}

Return a JSON array where each item has exactly these fields:
- "word": string (the word as given)
- "explanation": string (1-2 sentences, practical and conversational)
- "pronunciation": string (IPA format, e.g. /ɪˈloʊ.kwənt/)
- "examples": array of exactly 2 strings

Return ONLY the JSON array. No markdown, no extra text.`;

	const result = await generateContentWithRetry(prompt);
	const text = stripJson(result.response.text());
	return JSON.parse(text);
}

async function suggestWords(existingWords, count = 20, calibration = {}) {
	const known = existingWords.map(w => w.word);
	const easy = calibration.easy || [];
	const unknown = calibration.unknown || [];
	const knownList = known.length > 0 ? known.slice(-200).join(', ') : '(just starting out)';

	const prompt = `A language learner is building their English vocabulary. Their current word list: ${knownList}
Calibration signals:
- Words marked "Easy" were too easy or already familiar: ${easy.length > 0 ? easy.slice(-30).join(', ') : '(none yet)'}
- Words marked "No idea" were too hard or unfamiliar: ${unknown.length > 0 ? unknown.slice(-30).join(', ') : '(none yet)'}

Suggest ${count} new English words that:
- Match their apparent vocabulary level and interests based on existing words
- Adjust difficulty using the calibration signals: go a little harder than "Easy" words, but avoid jumping far beyond "No idea" words
- Are genuinely useful in real life (conversations, work, reading)
- Are NOT basic words (e.g. "banana", "run", "happy", colors, numbers)
- Do NOT already appear in their list
- Do NOT repeat calibration signal words

Return ONLY a JSON array of ${count} word strings. No markdown, no extra text.`;

	const result = await generateContentWithRetry(prompt);
	const text = stripJson(result.response.text());
	return JSON.parse(text);
}

async function askQuestion(question) {
	const prompt = `You are a helpful English language assistant for someone learning English as a second language. Answer their question clearly and practically — like a knowledgeable friend, not a textbook. Keep it concise but complete. Use examples where helpful.

Question: ${question}`;

	const result = await generateContentWithRetry(prompt);
	return result.response.text().trim();
}

async function lookupWord(word) {
	const prompt = `Look up the English word "${word}".

Return a JSON object with exactly these fields:
- "word": string (the word as given)
- "pos": string (part of speech, e.g. "noun", "verb", "adjective")
- "phonetic": string (IPA pronunciation, e.g. /ˈkɒn.tekst/)
- "zh": string (natural Simplified Chinese translation, concise — e.g. "语境；上下文；背景")
- "definition": string (1-2 sentences, clear and practical, like a smart friend explaining it)
- "example": string (one natural sentence using the word)
- "synonyms": array of 3-5 synonym strings
- "antonyms": array of 1-3 antonym strings (empty array if none apply)

Return ONLY the JSON object. No markdown, no extra text.`;

	const result = await generateContentWithRetry(prompt);
	const text = stripJson(result.response.text());
	return JSON.parse(text);
}

module.exports = { enrichWords, suggestWords, askQuestion, getFriendlyGeminiError, lookupWord };
