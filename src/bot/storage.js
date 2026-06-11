const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_SERVICE_KEY,
);

function toWord(row) {
	return {
		id: row.id,
		word: row.word,
		zh: row.zh ?? '',
		source: row.source,
		status: row.status,
		reviewCount: row.review_count ?? 0,
		correctCount: row.correct_count ?? 0,
		lastReviewed: row.last_reviewed,
		addedAt: row.added_at,
	};
}

function cleanWord(word) {
	return String(word || '').trim().toLowerCase();
}

function cleanWordList(words) {
	return [...new Set((words || [])
		.map(cleanWord)
		.filter(word => word.length > 1))];
}

function cleanCalibrationList(words) {
	return cleanWordList(words).slice(-50);
}

async function ensureUser(userId) {
	const { error } = await supabase
		.from('users')
		.upsert({ user_id: userId }, { onConflict: 'user_id' });
	if (error) throw error;
}

async function getUserData(userId) {
	await ensureUser(userId);

	const { data: user, error: userError } = await supabase
		.from('users')
		.select('api_token, calibration_easy, calibration_unknown')
		.eq('user_id', userId)
		.single();

	if (userError) throw userError;

	const { data: words, error: wordsError } = await supabase
		.from('words')
		.select('*')
		.eq('user_id', userId)
		.is('deleted_at', null)
		.order('added_at', { ascending: true });

	if (wordsError) throw wordsError;

	return {
		words: (words ?? []).map(toWord),
		apiToken: user?.api_token ?? undefined,
		calibration: {
			easy: cleanCalibrationList(user?.calibration_easy),
			unknown: cleanCalibrationList(user?.calibration_unknown),
		},
	};
}

async function saveUserData(userId, userData) {
	const { error } = await supabase
		.from('users')
		.upsert({
			user_id: userId,
			api_token: userData.apiToken ?? null,
		}, { onConflict: 'user_id' });
	if (error) throw error;
}

async function addWords(userId, words, source = 'feed') {
	await ensureUser(userId);

	const rows = cleanWordList(words)
		.map(word => ({
			user_id: userId,
			word,
			source,
			status: 'learning',
			deleted_at: null,
		}));

	if (rows.length === 0) return [];

	const { data, error } = await supabase
		.from('words')
		.upsert(rows, { onConflict: 'user_id,word' })
		.select('*');

	if (error) throw error;
	return (data ?? []).map(toWord);
}

async function deleteWord(userId, word) {
	const { data, error } = await supabase
		.from('words')
		.update({ deleted_at: new Date().toISOString() })
		.eq('user_id', userId)
		.ilike('word', word)
		.is('deleted_at', null)
		.select('word');

	if (error) throw error;
	return (data ?? []).length > 0;
}

async function saveWordZh(userId, word, zh) {
	if (!zh) return;
	await supabase
		.from('words')
		.update({ zh })
		.eq('user_id', userId)
		.ilike('word', word)
		.is('deleted_at', null);
}

async function setWordStatus(userId, word, status) {
	const { error } = await supabase
		.from('words')
		.update({ status })
		.eq('user_id', userId)
		.ilike('word', word)
		.is('deleted_at', null);

	if (error) throw error;
}

async function recordReview(userId, word, correct) {
	const { error } = await supabase.rpc('record_review', {
		p_user_id: userId,
		p_word: word,
		p_correct: correct,
	});

	if (error) throw error;
}

async function recordCalibration(userId, word, level) {
	await ensureUser(userId);

	const clean = cleanWord(word);
	if (!clean || !['easy', 'unknown'].includes(level)) return;

	const data = await getUserData(userId);
	const calibration = data.calibration || { easy: [], unknown: [] };
	const easy = cleanWordList(calibration.easy.filter(w => w !== clean));
	const unknown = cleanWordList(calibration.unknown.filter(w => w !== clean));

	if (level === 'easy') easy.push(clean);
	else unknown.push(clean);

	const { error } = await supabase
		.from('users')
		.update({
			calibration_easy: cleanCalibrationList(easy),
			calibration_unknown: cleanCalibrationList(unknown),
		})
		.eq('user_id', userId);

	if (error) throw error;
}

async function findUserByToken(token) {
	const cleanToken = String(token || '').trim();
	const { data, error } = await supabase
		.from('users')
		.select('user_id, api_token')
		.eq('api_token', cleanToken)
		.single();
	if (error || !data) return null;
	return {
		userId: data.user_id,
		data: await getUserData(data.user_id),
	};
}

module.exports = {
	getUserData,
	saveUserData,
	addWords,
	deleteWord,
	saveWordZh,
	setWordStatus,
	recordReview,
	recordCalibration,
	findUserByToken,
};
