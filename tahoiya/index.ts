import type {SlackInterface} from '../lib/slack';
import {Tahoiya} from './Tahoiya';

export default async (slackInterface: SlackInterface) => {
	const tahoiya = await Tahoiya.create(slackInterface);
	await tahoiya.initialize();
};

export {server} from './Tahoiya';