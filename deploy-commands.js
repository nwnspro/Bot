const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { token, clientId, guildId } = require('./src/bot/config');

const commands = [
	new SlashCommandBuilder()
		.setName('learn')
		.setDescription('Add words, or generate 10 AI suggestions to prune')
		.addStringOption(opt =>
			opt.setName('words')
				.setDescription('Optional words separated by spaces or commas')
				.setRequired(false),
		),

	new SlashCommandBuilder()
		.setName('calibrate')
		.setDescription('Tune future AI word suggestions with 5 quick signals'),

	new SlashCommandBuilder()
		.setName('review')
		.setDescription('Review saved words as spoiler flashcards')
		.addIntegerOption(opt =>
			opt.setName('count')
				.setDescription('How many words to review (default: 20)')
				.setMinValue(2)
				.setMaxValue(200),
		),

	new SlashCommandBuilder()
		.setName('wordlist')
		.setDescription('Browse all learned words with brief explanations')
		.addIntegerOption(opt =>
			opt.setName('page')
				.setDescription('Page number (default: 1)')
				.setMinValue(1),
		),

	new SlashCommandBuilder()
		.setName('ask')
		.setDescription('Ask any English language question')
		.addStringOption(opt =>
			opt.setName('question')
				.setDescription('e.g. "What\'s the difference between fluid and liquid?"')
				.setRequired(true),
		),

	new SlashCommandBuilder()
		.setName('mytoken')
		.setDescription('Get your API token for the Chrome extension (reply is private)'),

	new SlashCommandBuilder()
		.setName('delete')
		.setDescription('Remove a word from your list')
		.addStringOption(opt =>
			opt.setName('word')
				.setDescription('The word to remove')
				.setRequired(true),
		),
].map(c => c.toJSON());

const rest = new REST().setToken(token);

(async () => {
	try {
		console.log('Registering slash commands...');
		await rest.put(
			guildId
				? Routes.applicationGuildCommands(clientId, guildId)
				: Routes.applicationCommands(clientId),
			{ body: commands },
		);
		console.log('Done! Slash commands registered globally.');
	}
	catch (err) {
		console.error(err);
	}
})();
