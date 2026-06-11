const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserData, addWords, recordCalibration } = require('../storage');
const { suggestWords, getFriendlyGeminiError } = require('../ai/gemini');
const { lookupMany } = require('../dictionary');
const { buildAudioAttachment } = require('../audio-attachment');

const activeSessions = new Map();
const CALIBRATION_WORD_COUNT = 5;

module.exports = {
	name: 'calibrate',
	async execute(interaction) {
		const userId = interaction.user.id;

		if (activeSessions.has(userId)) {
			return interaction.reply({ content: 'You already have a calibration session running!', ephemeral: true });
		}

		await interaction.deferReply();

		const data = await getUserData(userId);
		const existing = new Set(data.words.map(w => w.word.toLowerCase()));

		await interaction.editReply('Building a quick calibration round...');

		let suggested;
		try {
			suggested = await suggestWords(data.words, CALIBRATION_WORD_COUNT, data.calibration);
		}
		catch (err) {
			console.error('[calibrate] suggestWords error:', err);
			return interaction.editReply(getFriendlyGeminiError(err));
		}

		const words = [...new Set(suggested
			.map(w => w.trim().toLowerCase())
			.filter(w => w.length > 1 && !existing.has(w)))]
			.slice(0, CALIBRATION_WORD_COUNT);

		if (words.length === 0) {
			return interaction.editReply('I could not find fresh calibration words right now. Try **/learn** first, then run **/calibrate** again.');
		}

		await interaction.editReply(`Calibrating future AI suggestions with **${words.length}** candidate words...`);
		const details = await lookupMany(words);
		const sessionWords = words.map((word, idx) => ({
			word,
			details: details[idx] || {},
		}));
		let index = 0;
		let easy = 0;
		let unknown = 0;
		let added = 0;

		activeSessions.set(userId, true);

		function wordEmbed(i) {
			const w = sessionWords[i];
			const definition = w.details.definition || 'No dictionary definition found.';
			const bilingualDefinition = w.details.zh ? `${w.details.zh} - ${definition}` : definition;
			const phonetic = w.details.phonetic || '';
			const example = w.details.example || 'No example available.';
			return new EmbedBuilder()
				.setColor(0x5865F2)
				.setTitle(`📖  ${w.word}   (${i + 1} / ${sessionWords.length})`)
				.setDescription(
					`${phonetic ? `🔊  **${phonetic}**\n\n` : ''}` +
          `||${bilingualDefinition}||\n\n` +
          `||${example}||`,
				)
				.setFooter({ text: 'Easy tunes suggestions. No idea also saves the word to your list.' });
		}

		function wordRow() {
			return new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId('calibrate_easy').setLabel('Easy').setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId('calibrate_unknown').setLabel('No idea').setStyle(ButtonStyle.Secondary),
				new ButtonBuilder().setCustomId('calibrate_stop').setLabel('Stop').setStyle(ButtonStyle.Danger),
			);
		}

		async function wordPayload(i) {
			const word = sessionWords[i];
			const attachment = await buildAudioAttachment(word.details, word.word);
			return {
				embeds: [wordEmbed(i)],
				components: [wordRow()],
				files: attachment ? [attachment] : [],
				attachments: [],
			};
		}

		function summaryEmbed(stopped = false) {
			const done = stopped ? index : sessionWords.length;
			return new EmbedBuilder()
				.setColor(0xFEE75C)
				.setTitle(stopped ? 'Calibration stopped' : 'Calibration saved')
				.setDescription(stopped ? `Went through **${done}** of **${sessionWords.length}** words.` : `Finished all **${sessionWords.length}** words!`)
				.addFields(
					{ name: 'Easy', value: `${easy}`, inline: true },
					{ name: 'No idea', value: `${unknown}`, inline: true },
					{ name: 'Added to wordlist', value: `${added}`, inline: true },
				);
		}

		await interaction.editReply(await wordPayload(0));

		const collector = interaction.channel.createMessageComponentCollector({
			filter: i => i.user.id === userId && i.customId.startsWith('calibrate_'),
			time: 15 * 60 * 1000,
		});

		collector.on('collect', async i => {
			const word = sessionWords[index];

			if (i.customId === 'calibrate_stop') {
				activeSessions.delete(userId);
				collector.stop('stopped');
				await i.update({ embeds: [summaryEmbed(true)], components: [] });
				return;
			}

			if (i.customId === 'calibrate_easy') {
				easy++;
				await recordCalibration(userId, word.word, 'easy');
			}
			else {
				unknown++;
				await recordCalibration(userId, word.word, 'unknown');
				await addWords(userId, [word.word], 'calibrate');
				added++;
			}

			index++;

			if (index >= sessionWords.length) {
				activeSessions.delete(userId);
				collector.stop('done');
				await i.update({ embeds: [summaryEmbed(false)], components: [] });
			}
			else {
				await i.update(await wordPayload(index));
			}
		});

		collector.on('end', async (_, reason) => {
			activeSessions.delete(userId);
			if (reason === 'time') {
				try {
					await interaction.editReply({ content: 'Session timed out.', embeds: [], components: [] });
				}
				catch {
					// The original interaction may already be gone.
				}
			}
		});
	},
};
