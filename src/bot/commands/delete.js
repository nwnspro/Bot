const { deleteWord } = require('../storage');

module.exports = {
	name: 'delete',
	async execute(interaction) {
		const word = interaction.options.getString('word').trim();
		const userId = interaction.user.id;

		const deleted = await deleteWord(userId, word);
		if (!deleted) {
			return interaction.reply({ content: `Couldn't find **${word}** in your list.`, ephemeral: true });
		}

		await interaction.reply({ content: `🗑️ **${word}** removed from your list.`, ephemeral: true });
	},
};
