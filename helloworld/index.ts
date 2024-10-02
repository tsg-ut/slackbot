import type {SlackInterface} from '../lib/slack';
import {HelloWorld} from './HelloWorld';

export default async (slackInterface: SlackInterface) => {
	const helloworld = await HelloWorld.create(slackInterface);

	helloworld.postHelloWorld();
};
