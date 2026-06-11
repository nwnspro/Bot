const crypto = require('crypto');
const { getUserData, saveUserData } = require('../storage');

module.exports = {
	name: 'mytoken',
	async execute(interaction) {
		const userId = interaction.user.id;
		const data = await getUserData(userId);

		if (!data.apiToken) {
			data.apiToken = crypto.randomBytes(20).toString('hex');
			await saveUserData(userId, data);
		}

		await interaction.reply({
			content: [
				'🔑  **Your Chrome extension token:**',
				`\`\`\`${data.apiToken}\`\`\``,
				'Paste this into the extension options page.',
				'⚠️  Keep it private — anyone with this token can add words to your list.',
				'',
				'Server URL to set in the extension: `http://localhost:3001`',
			].join('\n'),
			ephemeral: true,
		});
	},
};
