const { Client, Events, GatewayIntentBits, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { token } = require('./src/bot/config');
const fs = require('fs');
const path = require('path');
const { setClient } = require('./src/bot/extension-api/server');
const { deleteWord } = require('./src/bot/storage');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.commands = new Collection();

// Load all Discord slash commands from src/bot/commands/
const commandsPath = path.join(__dirname, 'src', 'bot', 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.name, command);
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  setClient(client);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton() && interaction.customId.startsWith('learn_reject_')) {
    const word = interaction.customId.replace('learn_reject_', '');
    try {
      await interaction.deferUpdate();
      await deleteWord(interaction.user.id, word);
      await interaction.editReply({
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(interaction.customId)
            .setLabel('Removed from my list')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        )],
      });
    } catch (err) {
      console.error('[learn_reject]', err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[${interaction.commandName}]`, err);
    const msg = { content: 'Something went wrong. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

client.login(token);
