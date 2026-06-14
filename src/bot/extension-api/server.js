const http = require('http');
const { EmbedBuilder } = require('discord.js');
const { addWords, saveWordZh, setWordStatus, recordReview, findUserByToken, createGuestUser, deleteWord } = require('../storage');
const { lookup, lookupMany } = require('../dictionary');

const PORT = process.env.PORT || 3001;
const MAX_EXTENSION_WORDS = 30;

// Holds the Discord client once the bot is ready.
// The HTTP server starts immediately (so Railway sees a bound port),
// and endpoints that need Discord return 503 until setClient() is called.
let discordClient = null;

function setClient(client) {
	discordClient = client;
}

function respond(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

async function parseBody(req) {
	return new Promise((resolve, reject) => {
		let body = '';
		req.on('data', chunk => { body += chunk; });
		req.on('end', () => {
			try { resolve(JSON.parse(body)); }
			catch { reject(new Error('Invalid JSON')); }
		});
	});
}

const server = http.createServer(async (req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	try {
		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url, 'http://localhost');

		if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
			return respond(res, 200, {
				ok: true,
				service: 'vocab-bot-extension-api',
				botReady: Boolean(discordClient),
			});
		}

		// ── POST /api/register ───────────────────────────────────────────────────
		// Creates a guest account (no Discord needed) and returns a token.
		if (req.method === 'POST' && url.pathname === '/api/register') {
			const { userId, apiToken } = await createGuestUser();
			console.log(`[register] new guest user ${userId}`);
			return respond(res, 200, { ok: true, token: apiToken });
		}

		// ── GET /api/enrich?token=&word= ─────────────────────────────────────────
		if (req.method === 'GET' && url.pathname === '/api/enrich') {
			const token = url.searchParams.get('token');
			const word = url.searchParams.get('word')?.trim();
			if (!token || !word) return respond(res, 400, { error: 'token and word required' });

			const user = await findUserByToken(token);
			if (!user) return respond(res, 401, { error: 'Invalid token. Run /mytoken in Discord.' });

			// Check if we already have a stored zh for this word (avoids hitting
			// the MyMemory rate limit on every lookup).
			const stored = user.data.words.find(
				entry => entry.word.toLowerCase() === word.toLowerCase(),
			);
			const storedZh = stored?.zh || '';

			let result;
			try {
				result = await lookup(word);
			}
			catch (err) {
				console.error('[enrich]', err);
				result = null;
			}

			// Prefer a freshly-translated zh; fall back to whatever is in the DB.
			if (result && !result.zh && storedZh) result.zh = storedZh;

			try {
				if (!stored) {
					await addWords(user.userId, [word], 'extension');
				}
				// Persist zh to the DB so future lookups don't need to re-translate.
				const zhToSave = result?.zh || storedZh;
				if (zhToSave && (!storedZh || storedZh !== zhToSave)) {
					await saveWordZh(user.userId, word, zhToSave);
				}
			}
			catch (err) {
				console.error('[enrich] save error', err);
			}

			return respond(res, 200, {
				ok: true,
				...(result || {
					word,
					definition: 'No dictionary entry found, but the word was saved to your list.',
					phonetic: '',
					example: '',
					synonyms: [],
					antonyms: [],
				}),
			});
		}

		// ── GET /api/words/list?token= ──────────────────────────────────────────
		// Lightweight endpoint — returns word names + statuses only, no dictionary lookups.
		if (req.method === 'GET' && url.pathname === '/api/words/list') {
			const token = url.searchParams.get('token');
			if (!token) return respond(res, 400, { error: 'token required' });
			const user = await findUserByToken(token);
			if (!user) return respond(res, 401, { error: 'Invalid token. Run /mytoken in Discord.' });
			const words = user.data.words
				.filter(w => w.status !== 'known')
				.map(w => ({ word: w.word, status: w.status }));
			return respond(res, 200, { ok: true, words });
		}

		// ── GET /api/words?token= ────────────────────────────────────────────────
		if (req.method === 'GET' && url.pathname === '/api/words') {
			const token = url.searchParams.get('token');
			if (!token) return respond(res, 400, { error: 'token required' });
			const user = await findUserByToken(token);
			if (!user) return respond(res, 401, { error: 'Invalid token. Run /mytoken in Discord.' });
			const learning = user.data.words.filter(w => w.status !== 'known');
			const details = await lookupMany(learning.map(w => w.word));
			const words = learning.map((w, index) => ({
				...w,
				...(details[index] || {}),
				pronunciation: details[index]?.phonetic || '',
				examples: details[index]?.example ? [details[index].example] : [],
			}));
			return respond(res, 200, { ok: true, words });
		}

		// ── POST /api/word-status { token, word, status } ────────────────────────
		if (req.method === 'POST' && url.pathname === '/api/word-status') {
			let parsed;
			try { parsed = await parseBody(req); }
			catch { return respond(res, 400, { error: 'Invalid JSON' }); }
			const { token, word, status } = parsed;
			if (!token || !word || !status) return respond(res, 400, { error: 'token, word, status required' });
			const user = await findUserByToken(token);
			if (!user) return respond(res, 401, { error: 'Invalid token. Run /mytoken in Discord.' });
			await setWordStatus(user.userId, word, status);
			await recordReview(user.userId, word, status === 'known');
			return respond(res, 200, { ok: true });
		}

		// ── POST /api/delete-word { token, word } ───────────────────────────────
		if (req.method === 'POST' && url.pathname === '/api/delete-word') {
			let parsed;
			try { parsed = await parseBody(req); }
			catch { return respond(res, 400, { error: 'Invalid JSON' }); }
			const { token, word } = parsed;
			if (!token || !word) return respond(res, 400, { error: 'token and word required' });
			const user = await findUserByToken(token);
			if (!user) return respond(res, 401, { error: 'Invalid token. Run /mytoken in Discord.' });
			await deleteWord(user.userId, word);
			return respond(res, 200, { ok: true });
		}

		// ── POST /api/feed ───────────────────────────────────────────────────────
		if (req.method === 'POST' && url.pathname === '/api/feed') {
			if (!discordClient) return respond(res, 503, { error: 'Bot not ready yet. Try again in a moment.' });

			let parsed;
			try { parsed = await parseBody(req); }
			catch { return respond(res, 400, { error: 'Invalid JSON' }); }

			const { token, words } = parsed;
			if (!token || !Array.isArray(words) || words.length === 0) {
				return respond(res, 400, { error: 'token and words[] required' });
			}

			const user = await findUserByToken(token);
			if (!user) return respond(res, 401, { error: 'Invalid token. Run /mytoken in Discord.' });

			const { userId, data } = user;
			const existing = new Set(data.words.map(w => w.word.toLowerCase()));
			const newWords = [...new Set(words
				.map(w => w.trim().toLowerCase())
				.filter(w => w.length > 1 && !existing.has(w)))]
				.slice(0, MAX_EXTENSION_WORDS);

			if (newWords.length === 0) {
				return respond(res, 200, { ok: true, message: 'All words already in your list.' });
			}

			respond(res, 200, { ok: true, message: `Processing ${newWords.length} word(s)...` });

			try {
				await addWords(userId, newWords, 'extension');
				const details = await lookupMany(newWords);

				const discordUser = await discordClient.users.fetch(userId);
				const embeds = newWords.map((word, index) => {
					const e = details[index] || { word, definition: 'No dictionary definition found.', phonetic: '', example: '' };
					return (
						new EmbedBuilder()
							.setColor(0xEB459E)
							.setTitle(`📖  ${e.word}  *(from browser)*`)
							.setDescription(`${e.definition || 'No dictionary definition found.'}${e.phonetic ? `\n\n🔊  **${e.phonetic}**` : ''}`)
							.addFields({ name: 'Example', value: e.example || 'No example available.' })
					);
				});
				await discordUser.send({
					content: `✅ Added **${newWords.length}** word(s) from your browser! Use **/calibrate** to tune suggestions or **/review** to practice.`,
					embeds: embeds.slice(0, 10),
				});
			}
			catch (err) {
				console.error('[server] Processing error:', err);
			}
			return;
		}

		respond(res, 404, { error: 'Not found' });
	}
	catch (err) {
		console.error('[extension-api] Request failed:', {
			method: req.method,
			url: req.url,
			message: err.message,
			stack: err.stack,
		});
		if (!res.headersSent) {
			return respond(res, 500, { error: 'Extension API failed. Check Railway deployment logs.' });
		}
		res.end();
	}
});

server.listen(PORT, () => console.log(`Extension API listening on port ${PORT}`));

module.exports = { setClient };
