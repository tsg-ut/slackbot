import {WebClient, RTMClient} from '@slack/client';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

export default ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	rtm.on('message', async (message) => {
	});
};
