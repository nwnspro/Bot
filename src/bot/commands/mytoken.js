const crypto = require('crypto');
const { getUserData, saveUserData } = require('../storage');

function getServerUrl() {
	if (process.env.EXTENSION_SERVER_URL) return process.env.EXTENSION_SERVER_URL.replace(/\/$/, '');
	if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
	return 'http://localhost:3001';
}

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
				`Server URL to set in the extension: \`${getServerUrl()}\``,
			].join('\n'),
			ephemeral: true,
		});
	},
};
