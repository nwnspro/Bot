const { EmbedBuilder } = require('discord.js');
const { askQuestion, getFriendlyGeminiError } = require('../ai/gemini');

module.exports = {
	name: 'ask',
	async execute(interaction) {
		await interaction.deferReply();

		const question = interaction.options.getString('question');

		let answer;
		try {
			answer = await askQuestion(question);
		}
		catch (err) {
			console.error('[ask] Gemini error:', err);
			return interaction.editReply(getFriendlyGeminiError(err));
		}

		// Discord embed description cap is 4096 chars
		const chunks = [];
		for (let i = 0; i < answer.length; i += 4096) {
			chunks.push(answer.slice(i, i + 4096));
		}

		const embeds = chunks.map((chunk, i) =>
			new EmbedBuilder()
				.setColor(0xEB459E)
				.setTitle(i === 0 ? `💬  ${question}` : null)
				.setDescription(chunk),
		);

		await interaction.editReply({ embeds: [embeds[0]] });
		for (let i = 1; i < embeds.length; i++) {
			await interaction.followUp({ embeds: [embeds[i]] });
		}
	},
};
