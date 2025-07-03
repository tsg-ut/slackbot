import type {SlackInterface} from '../lib/slack.js';
import {HelloWorld} from './HelloWorld.js';

export default async (slackInterface: SlackInterface) => {
	const helloworld = await HelloWorld.create(slackInterface);

	helloworld.postHelloWorld();
};
