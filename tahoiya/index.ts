import type {SlackInterface} from '../lib/slack';
import {Tahoiya} from './Tahoiya';

export default async (slack: SlackInterface) => {
	await Tahoiya.create(slack);
};
