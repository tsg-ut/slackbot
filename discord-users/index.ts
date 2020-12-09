import { RTMClient } from '@slack/rtm-api';
import { WebClient } from '@slack/web-api';
import path from 'path';
import {constants, promises as fs} from 'fs';

interface DiscordUser{
  uidSlack: string;
  uidDiscord: string;
}

export default async ({
  rtmClient: rtm,
  webClient: slack,
}: {
  rtmClient: RTMClient;
  webClient: WebClient;
}) => {
  const usersfilePath = path.resolve(__dirname, 'users.json');
	const exists = await fs.access(usersfilePath, constants.F_OK).then(() => true).catch(() => false);
	const discordUsers: DiscordUser[] = (exists ? JSON.parse((await fs.readFile(usersfilePath)).toString()).users : []);

	await fs.writeFile(usersfilePath, JSON.stringify({users: discordUsers}));
	const setState = (object: {[key: string]: any}) => {
		Object.assign(usersfilePath, object);
		return fs.writeFile(usersfilePath, JSON.stringify(discordUsers));
  };
  
  rtm.on('message', async message => {
    if (message.channel !== process.env.CHANNEL_SANDBOX) {
      return;
    }
    if (
      message.subtype === 'bot_message' ||
      message.subtype === 'slackbot_response'
    ) {
      return;
    }
    if (!message.text) {
      return;
    }

    if (message.text.match(/^@discord \d{18}$/)){
      
    }
  });
};