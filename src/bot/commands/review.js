const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserData, deleteWord, recordReview } = require('../storage');
const { lookupMany } = require('../dictionary');
const { buildAudioAttachment } = require('../audio-attachment');

const activeSessions = new Map();

function spoiler(text) {
	return `||${String(text || '').replace(/\|/g, '\\|')}||`;
}

function buildAnswer(details) {
	const definition = details.definition || 'No dictionary definition found.';
	const zh = details.zh ? `${details.zh} - ` : '';
	const example = details.example ? `\n\nExample: ${details.example}` : '';
	return `${zh}${definition}${example}`;
}

module.exports = {
	name: 'review',
	async execute(interaction) {
		const userId = interaction.user.id;

		if (activeSessions.has(userId)) {
			return interaction.reply({ content: 'You already have a review session running!', ephemeral: true });
		}

		await interaction.deferReply();

		const data = await getUserData(userId);
		if (data.words.length < 1) {
			return interaction.editReply('You need at least 1 word to review. Use **/learn** to add one!');
		}

		const count = Math.min(interaction.options.getInteger('count') || 20, data.words.length);
		const selectedWords = [...data.words].sort(() => Math.random() - 0.5).slice(0, count);

		await interaction.editReply(`Preparing **${selectedWords.length}** review card(s)...`);
		const details = await lookupMany(selectedWords.map(w => w.word));
		const cards = selectedWords.map((word, index) => ({
			...word,
			details: details[index] || {},
		}));

		let index = 0;
		let reviewed = 0;
		let retired = 0;

		activeSessions.set(userId, true);

		function buildCard() {
			const card = cards[index];
			const phonetic = card.details.phonetic ? `\n${card.details.phonetic}` : '';
			return new EmbedBuilder()
				.setColor(0x5865F2)
				.setTitle(`Review  ${index + 1} / ${cards.length}`)
				.setDescription(`## ${card.word}${phonetic}\n\n${spoiler(buildAnswer(card.details))}`)
				.setFooter({ text: 'Click the spoiler to reveal the answer.' });
		}

		function buildRow(isLast = false) {
			return new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId('review_retire')
					.setLabel('Too easy')
					.setStyle(ButtonStyle.Secondary),
				new ButtonBuilder()
					.setCustomId('review_next')
					.setLabel(isLast ? 'Finish' : 'Next')
					.setStyle(ButtonStyle.Primary),
			);
		}

		function buildSummary() {
			return new EmbedBuilder()
				.setColor(0x57F287)
				.setTitle('Review recap')
				.setDescription(`Reviewed **${reviewed}** word(s).\nRetired **${retired}** word(s) from your active list.`);
		}

		function currentPayload() {
			const card = cards[index];
			return buildAudioAttachment(card.details, card.word).then(attachment => ({
				embeds: [buildCard()],
				components: [buildRow(index >= cards.length - 1)],
				files: attachment ? [attachment] : [],
				attachments: [],
			}));
		}

		await interaction.editReply(await currentPayload());
		const message = await interaction.fetchReply();
		const collector = message.createMessageComponentCollector({
			filter: i => i.user.id === userId && i.customId.startsWith('review_'),
			time: 20 * 60 * 1000,
		});

		async function moveNext(i) {
			index++;
			if (index >= cards.length) {
				collector.stop('done');
				await i.update({ embeds: [buildSummary()], components: [] });
				return;
			}

			await i.update(await currentPayload());
		}

		collector.on('collect', async i => {
			const card = cards[index];
			if (!card) {
				collector.stop('done');
				await i.update({ embeds: [buildSummary()], components: [] });
				return;
			}

			if (i.customId === 'review_retire') {
				const deleted = await deleteWord(userId, card.word);
				if (deleted) retired++;
				await moveNext(i);
				return;
			}

			await recordReview(userId, card.word, true);
			reviewed++;
			await moveNext(i);
		});

		collector.on('end', async (_, reason) => {
			activeSessions.delete(userId);
			if (reason === 'time') {
				try {
					await interaction.editReply({ content: 'Review timed out.', embeds: [], components: [] });
				}
				catch {
					// The original interaction may already be gone.
				}
			}
		});
	},
};
