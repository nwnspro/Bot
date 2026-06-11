const {
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
} = require('discord.js');
const { getUserData, addWords } = require('../storage');
const { suggestWords, getFriendlyGeminiError } = require('../ai/gemini');
const { lookupMany } = require('../dictionary');
const { buildAudioAttachment } = require('../audio-attachment');

const AI_LEARN_COUNT = 10;
const AI_LEARN_ATTEMPTS = 3;

function parseWords(input) {
	return [...new Set((input || '')
		.split(/[,\s]+/)
		.map(w => w.trim().toLowerCase())
		.filter(w => w.length > 1))];
}

function getWordDetail(word, details, index) {
	return details[index] || {
		word,
		zh: '',
		definition: 'No dictionary definition found.',
		phonetic: '',
		audio: '',
		example: '',
	};
}

function buildWordEmbed(word, entry, color, progress = '') {
	const definition = entry.definition || 'No dictionary definition found.';
	const bilingualDefinition = entry.zh ? `${entry.zh} - ${definition}` : definition;
	const description = [
		bilingualDefinition,
		entry.phonetic ? `🔊  **${entry.phonetic}**` : '',
	].filter(Boolean).join('\n\n');

	const title = `📖  ${entry.word || word}${progress ? `  ${progress}` : ''}`;

	return (
		new EmbedBuilder()
			.setColor(color)
			.setTitle(title)
			.setDescription(description)
			.addFields({ name: 'Example', value: entry.example || 'No example available.' })
	);
}

function buildWordEmbeds(words, details, color) {
	return words.map((word, index) => {
		const entry = getWordDetail(word, details, index);
		return buildWordEmbed(word, entry, color);
	});
}

async function filesForWord(entry, word) {
	const attachment = await buildAudioAttachment(entry, word);
	return attachment ? [attachment] : [];
}

async function getFreshSuggestions(data, existing, targetCount) {
	const picked = [];
	const seen = new Set(existing);

	for (let attempt = 1; attempt <= AI_LEARN_ATTEMPTS && picked.length < targetCount; attempt++) {
		const needed = targetCount - picked.length;
		const requestCount = Math.max(targetCount, needed * 3);
		const suggested = await suggestWords(
			[...data.words, ...picked.map(word => ({ word }))],
			requestCount,
			data.calibration,
		);

		for (const word of suggested) {
			const clean = String(word || '').trim().toLowerCase();
			if (!clean || seen.has(clean)) continue;
			seen.add(clean);
			picked.push(clean);
			if (picked.length >= targetCount) break;
		}
	}

	return picked;
}

function buildRejectRow(word, rejected = false) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`learn_reject_${word}`)
			.setLabel(rejected ? 'Removed from my list' : 'Not for me')
			.setStyle(ButtonStyle.Primary)
			.setDisabled(rejected),
	);
}

module.exports = {
	name: 'learn',
	async execute(interaction) {
		await interaction.deferReply();

		const userId = interaction.user.id;
		const data = await getUserData(userId);
		const inputWords = parseWords(interaction.options.getString('words'));
		const existing = new Set(data.words.map(w => w.word.toLowerCase()));

		if (inputWords.length > 0) {
			const newWords = inputWords.filter(w => !existing.has(w));
			const duplicates = inputWords.filter(w => existing.has(w));

			if (newWords.length === 0) {
				return interaction.editReply(`All those words are already in your list: **${duplicates.join(', ')}**`);
			}

			await interaction.editReply(`Adding **${newWords.join(', ')}** and fetching dictionary details...`);
			await addWords(userId, newWords, 'learn');

			const details = await lookupMany(newWords);
			const embeds = buildWordEmbeds(newWords, details, 0x57F287);
			let msg = `Added **${newWords.length}** word(s) to your list.`;
			if (duplicates.length > 0) msg += `  *(skipped already saved: ${duplicates.join(', ')})*`;

			if (newWords.length === 1) {
				const entry = getWordDetail(newWords[0], details, 0);
				await interaction.editReply({
					content: msg,
					embeds,
					files: await filesForWord(entry, newWords[0]),
				});
			}
			else {
				await interaction.editReply({ content: msg });
				for (const [index, embed] of embeds.entries()) {
					const entry = getWordDetail(newWords[index], details, index);
					await interaction.followUp({
						embeds: [embed],
						files: await filesForWord(entry, newWords[index]),
					});
				}
			}
			return;
		}

		await interaction.editReply('Generating a personalised word list for your level...');

		let toFetch;
		try {
			toFetch = await getFreshSuggestions(data, existing, AI_LEARN_COUNT);
		}
		catch (err) {
			console.error('[learn] suggestWords error:', err);
			return interaction.editReply(getFriendlyGeminiError(err));
		}

		if (toFetch.length === 0) {
			return interaction.editReply('I could not find fresh AI suggestions this time. Try **/calibrate** once, then run **/learn** again.');
		}

		await interaction.editReply(`Got **${toFetch.length}** suggested words — fetching dictionary details...`);
		const details = await lookupMany(toFetch);
		await addWords(userId, toFetch, 'suggested');

		const suggestions = toFetch.map((word, index) => ({
			word,
			detail: getWordDetail(word, details, index),
		}));

		for (const [index, suggestion] of suggestions.entries()) {
			const payload = {
				content: index === 0
					? `I added **${suggestions.length}** AI-picked words to your list. Tap **Not for me** under any word you want to remove.`
					: undefined,
				embeds: [buildWordEmbed(suggestion.word, suggestion.detail, 0x57F287, `(${index + 1}/${suggestions.length})`)],
				components: [buildRejectRow(suggestion.word)],
				files: await filesForWord(suggestion.detail, suggestion.word),
			};

			if (index === 0) {
				await interaction.editReply(payload);
			}
			else {
				await interaction.followUp(payload);
			}
		}
	},
};
