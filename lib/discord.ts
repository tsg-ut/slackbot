import Discord, {GatewayIntentBits} from 'discord.js';

// eslint-disable-next-line import/no-named-as-default-member
const discord = new Discord.Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.MessageContent,
	],
});

discord.login(process.env.TSGBOT_DISCORD_TOKEN);

export default discord;