import {Client, GatewayIntentBits} from 'discord.js';

const discord = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.MessageContent,
	],
});

discord.login(process.env.TSGBOT_DISCORD_TOKEN);

export default discord;