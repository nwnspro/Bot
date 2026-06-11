const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserData } = require('../storage');
const { lookupMany } = require('../dictionary');

const PAGE_SIZE = 10;

function formatDate(value) {
	if (!value) return 'unknown date';
	return new Date(value).toLocaleDateString('en-NZ', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

module.exports = {
	name: 'wordlist',
	async execute(interaction) {
		await interaction.deferReply();

		const userId = interaction.user.id;
		const data = await getUserData(userId);

		if (data.words.length === 0) {
			return interaction.editReply('No words yet! Use **/learn** to add your own or get AI suggestions.');
		}

		let page = Math.max(0, (interaction.options.getInteger('page') || 1) - 1);
		const totalPages = Math.ceil(data.words.length / PAGE_SIZE);
		page = Math.min(page, totalPages - 1);

		async function buildEmbed(p) {
			const start = p * PAGE_SIZE;
			const slice = data.words.slice(start, start + PAGE_SIZE);
			const details = await lookupMany(slice.map(w => w.word));
			const lines = slice.map((w, i) => {
				const icon = w.status === 'known' ? '✅' : '📚';
				const definition = details[i]?.definition || 'No dictionary definition found.';
				return `${icon} **${start + i + 1}. ${w.word}** - ${definition}\nAdded ${formatDate(w.addedAt)}`;
			});
			return new EmbedBuilder()
				.setColor(0x5865F2)
				.setTitle('📚  Your Word List')
				.setDescription(lines.join('\n\n'))
				.setFooter({ text: `Page ${p + 1}/${totalPages}  •  ${data.words.length} words total  •  ✅ known  📚 learning` });
		}

		function buildRow(p) {
			return new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId('hist_prev')
					.setLabel('◀  Prev')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(p === 0),
				new ButtonBuilder()
					.setCustomId('hist_next')
					.setLabel('Next  ▶')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(p >= totalPages - 1),
			);
		}

		await interaction.editReply({
			embeds: [await buildEmbed(page)],
			components: totalPages > 1 ? [buildRow(page)] : [],
		});

		if (totalPages <= 1) return;

		const collector = interaction.channel.createMessageComponentCollector({
			filter: i => i.user.id === userId && i.customId.startsWith('hist_'),
			time: 5 * 60 * 1000,
		});

		collector.on('collect', async i => {
			if (i.customId === 'hist_prev') page = Math.max(0, page - 1);
			if (i.customId === 'hist_next') page = Math.min(totalPages - 1, page + 1);
			await i.deferUpdate();
			await interaction.editReply({ embeds: [await buildEmbed(page)], components: [buildRow(page)] });
		});

		collector.on('end', async () => {
			try {
				await interaction.editReply({ components: [] });
			}
			catch {
				// The original interaction may already be gone.
			}
		});
	},
};
