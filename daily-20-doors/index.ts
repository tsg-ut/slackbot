import type {SlackInterface} from '../lib/slack';
import {Daily20Doors} from './Daily20Doors';

export default async (slackInterface: SlackInterface) => {
	const daily20doors = await Daily20Doors.create(slackInterface);
	daily20doors.initialize();
	await daily20doors.postDailyChallenge();
};

