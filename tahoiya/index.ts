import type {SlackInterface} from '../lib/slack';
import TahoiyaBot from './TahoiyaBot';

export default async (slackInterface: SlackInterface) => {
	const tahoiya = new TahoiyaBot(slackInterface);
	await tahoiya.initialize();
};

export const server = ({webClient, eventClient, messageClient}: SlackInterface) => {
	const bot = new TahoiyaBot({webClient, eventClient, messageClient});
	return bot.getServerPlugin();
};
