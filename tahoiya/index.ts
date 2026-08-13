import type {SlackInterface} from '../lib/slack.js';
import {Tahoiya} from './Tahoiya.js';

export default async (slack: SlackInterface) => {
	await Tahoiya.create(slack);
};
