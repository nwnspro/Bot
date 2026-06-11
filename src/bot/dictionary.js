const https = require('https');
const { translateToZh } = require('./translator');

// ── In-memory cache ───────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function fromCache(word) {
	const entry = cache.get(word.toLowerCase());
	if (!entry) return null;
	if (Date.now() - entry.time > CACHE_TTL_MS) { cache.delete(word.toLowerCase()); return null; }
	return entry.result;
}

function toCache(word, result) {
	if (cache.size >= 500) cache.delete(cache.keys().next().value);
	cache.set(word.toLowerCase(), { result, time: Date.now() });
}

const REQUEST_TIMEOUT_MS = 4500;

function get(url) {
	return new Promise((resolve, reject) => {
		const req = https.get(url, res => {
			let data = '';
			res.on('data', c => { data += c; });
			res.on('end', () => resolve({ status: res.statusCode, body: data }));
		});

		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			req.destroy(new Error('Request timed out'));
		});
		req.on('error', reject);
	});
}

function datamuseUrl(params) {
	const query = new URLSearchParams(params);
	return `https://api.datamuse.com/words?${query.toString()}`;
}

async function getJson(url) {
	const { status, body } = await get(url);
	if (status < 200 || status >= 300) return null;
	return JSON.parse(body);
}

function pronunciationFromDatamuse(result) {
	const pronTag = result?.tags?.find(tag => tag.startsWith('pron:'));
	return pronTag ? `/${pronTag.slice(5)}/` : '';
}

function definitionFromDatamuse(result) {
	const def = result?.defs?.[0] || '';
	return def.replace(/^[a-z]+\t/, '');
}

// ── Merriam-Webster helpers ───────────────────────────────────────────────────

function mwAudioUrl(audio) {
	if (!audio) return '';
	let subdir;
	if (audio.startsWith('bix')) subdir = 'bix';
	else if (audio.startsWith('gg')) subdir = 'gg';
	else if (/^\d/.test(audio)) subdir = 'number';
	else subdir = audio[0];
	return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdir}/${audio}.mp3`;
}

function stripMwMarkup(text) {
	if (!text) return '';
	return text
		.replace(/\{bc\}/g, '')
		.replace(/\{it\}(.*?)\{\/it\}/gs, '$1')
		.replace(/\{b\}(.*?)\{\/b\}/gs, '$1')
		.replace(/\{ldquo\}/g, '\u201c')
		.replace(/\{rdquo\}/g, '\u201d')
		.replace(/\{inf\}(.*?)\{\/inf\}/gs, '$1')
		.replace(/\{sup\}(.*?)\{\/sup\}/gs, '$1')
		.replace(/\{[^}]+\}/g, '')
		.trim();
}

function extractMwDtText(dt) {
	for (const [type, val] of (dt || [])) {
		if (type === 'text') return stripMwMarkup(val);
	}
	return '';
}

function extractMwExample(dt) {
	for (const [type, val] of (dt || [])) {
		if (type === 'vis' && Array.isArray(val)) {
			const ex = val[0]?.t;
			if (ex) return stripMwMarkup(ex);
		}
	}
	return '';
}

async function lookupLearnersDictionary(cleanWord) {
	const key = process.env.MERRIAM_LEARNERS_KEY;
	if (!key) return null;
	try {
		const data = await getJson(
			`https://www.dictionaryapi.com/api/v3/references/learners/json/${encodeURIComponent(cleanWord)}?key=${key}`,
		);
		if (!Array.isArray(data) || typeof data[0] !== 'object') return null;

		const entry = data[0];
		const hw = entry?.hwi?.hw?.replace(/\*/g, '') || cleanWord;
		const pos = entry?.fl || '';
		const prs = entry?.hwi?.prs?.[0];
		const phonetic = prs?.mw ? `/${prs.mw}/` : '';
		const audio = mwAudioUrl(prs?.sound?.audio || '');

		let definition = '';
		let example = '';
		outer: for (const defBlock of (entry?.def || [])) {
			for (const sseqGroup of (defBlock?.sseq || [])) {
				for (const [senseType, senseData] of sseqGroup) {
					const dt = senseType === 'sense' ? senseData?.dt
						: senseType === 'bs' ? senseData?.sense?.dt
						: null;
					if (!dt) continue;
					if (!definition) definition = extractMwDtText(dt);
					if (!example) example = extractMwExample(dt);
					if (definition && example) break outer;
				}
			}
		}

		if (!definition) return null;
		const zh = await translateToZh(hw);
		return { word: hw, pos, phonetic, audio, zh, definition, example, synonyms: [], antonyms: [] };
	}
	catch {
		return null;
	}
}

async function lookupMerriamThesaurus(cleanWord) {
	const key = process.env.MERRIAM_THESAURUS_KEY;
	if (!key) return null;
	try {
		const data = await getJson(
			`https://www.dictionaryapi.com/api/v3/references/thesaurus/json/${encodeURIComponent(cleanWord)}?key=${key}`,
		);
		if (!Array.isArray(data) || typeof data[0] !== 'object') return null;
		const syns = data[0]?.meta?.syns?.flat() || [];
		const ants = data[0]?.meta?.ants?.flat() || [];
		return { synonyms: syns.slice(0, 5), antonyms: ants.slice(0, 3) };
	}
	catch {
		return null;
	}
}

async function lookupDatamuse(cleanWord) {
	const [wordData, synonyms, antonyms] = await Promise.all([
		getJson(datamuseUrl({
			sp: cleanWord,
			qe: 'sp',
			md: 'dpr',
			ipa: '1',
			max: '1',
		})),
		getJson(datamuseUrl({
			rel_syn: cleanWord,
			max: '5',
		})),
		getJson(datamuseUrl({
			rel_ant: cleanWord,
			max: '3',
		})),
	]);

	const exact = wordData?.find(item => item.word?.toLowerCase() === cleanWord.toLowerCase()) || wordData?.[0];
	const definition = definitionFromDatamuse(exact);
	if (!definition && !synonyms?.length && !antonyms?.length) return null;

	const zh = await translateToZh(cleanWord);
	return {
		word: exact?.word || cleanWord,
		pos: exact?.tags?.find(tag => ['n', 'v', 'adj', 'adv'].includes(tag)) || '',
		phonetic: pronunciationFromDatamuse(exact),
		audio: '',
		zh,
		definition,
		example: '',
		synonyms: (synonyms || []).map(item => item.word).filter(Boolean).slice(0, 5),
		antonyms: (antonyms || []).map(item => item.word).filter(Boolean).slice(0, 3),
	};
}

async function lookupFreeDictionary(cleanWord) {
	let { status, body } = await get(
		`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`,
	);
	if (status !== 200 && cleanWord !== cleanWord.toLowerCase()) {
		({ status, body } = await get(
			`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord.toLowerCase())}`,
		));
	}
	if (status !== 200) return null;
	const [entry] = JSON.parse(body);
	if (!entry) return null;

	const meanings = entry.meanings || [];
	const definitions = meanings.flatMap(meaning =>
		(meaning.definitions || []).map(definition => ({ meaning, definition })),
	);
	const first = definitions.find(item => item.definition?.definition) || definitions[0];
	const example = definitions.find(item => item.definition?.example)?.definition?.example || '';
	const phonetic = entry.phonetics?.find(p => p.text)?.text || entry.phonetic || '';
	const audio = entry.phonetics?.find(p => p.audio)?.audio || '';
	const synonyms = meanings
		.flatMap(meaning => [
			...(meaning.synonyms || []),
			...(meaning.definitions || []).flatMap(definition => definition.synonyms || []),
		]);
	const antonyms = meanings
		.flatMap(meaning => [
			...(meaning.antonyms || []),
			...(meaning.definitions || []).flatMap(definition => definition.antonyms || []),
		]);
	const zh = await translateToZh(entry.word || cleanWord);

	return {
		word: entry.word,
		pos: first?.meaning?.partOfSpeech || '',
		phonetic,
		audio,
		zh,
		definition: first?.definition?.definition || '',
		example,
		synonyms: [...new Set(synonyms)].slice(0, 5),
		antonyms: [...new Set(antonyms)].slice(0, 3),
	};
}

async function lookup(word) {
	const cleanWord = String(word || '').trim();
	if (!cleanWord) return null;

	const cached = fromCache(cleanWord);
	if (cached) return cached;

	try {
		const [learners, thesaurus] = await Promise.all([
			lookupLearnersDictionary(cleanWord),
			lookupMerriamThesaurus(cleanWord),
		]);

		let result = learners
			|| await lookupFreeDictionary(cleanWord)
			|| await lookupDatamuse(cleanWord);

		if (!result) return null;

		if (thesaurus) {
			result.synonyms = thesaurus.synonyms.length ? thesaurus.synonyms : result.synonyms;
			result.antonyms = thesaurus.antonyms.length ? thesaurus.antonyms : result.antonyms;
		}

		toCache(cleanWord, result);
		return result;
	}
	catch {
		return null;
	}
}

async function lookupMany(words) {
	return Promise.all(words.map(lookup));
}

module.exports = { lookup, lookupMany };
