const schedule = require('node-schedule');
const {promises: fs, constants} = require('fs');
const path = require('path');
const moment = require('moment');
const { clamp, random } = require('lodash');

// どうしてこれらのojiginekoが選ばれたかって？僕がこいつらがかわいいとおもったからさ。
const ojiginekoActivities = [
	'dot-ojigineko',
	'harassment-ojigineko',
	'nameraka-ojigineko',
	'nameraka-ojigineko-extreme-fast',
	'ojigineko',
	'ojigineko-extremefast',
	'ojigineko-fast',
	'ojigineko-hd',
	'ojigineko-mirror',
	'ojigineko-muscle-exercise',
	'ojigineko-sleeping',
	'ojigineko-superfast',
	'ojigineko-upside-down',
	'ojigineko-waking',
	'party-ojigineko',
	'tosshutsu-symmetry-ojigineko',
];

const statePath = path.resolve(__dirname, 'state.json');

const loadState = async () => {
	const exists = await fs.access(statePath, constants.F_OK).then(() => true).catch(() => false);

	if (exists) {
		const stateData = await fs.readFile(statePath);
		return JSON.parse(stateData.toString());
	}

	return {
		isSleeping: false,
		location: 8,
		gone: false,
	};
};

module.exports = async (clients) => {
	const { rtmClient: rtm, webClient: slack } = clients;
	const state = await loadState();

	const setState = async (newState) => {
		Object.assign(state, newState);
		await fs.writeFile(statePath, JSON.stringify(state));
	};

	const p = 1 / (365 * 24);

	schedule.scheduleJob('30 * * * *', async (date) => {
		if (Math.random() < p)
			state.gone = true;
		if (state.gone)
			return;

		const hour = moment(date).utcOffset(9).hour();

		if (state.isSleeping) {
			if (
				(hour === 6 && Math.random() < 0.05) ||
				(hour === 7 && Math.random() < 0.1) ||
				(hour === 8 && Math.random() < 0.2) ||
				(hour === 9 && Math.random() < 0.4) ||
				(hour === 10 && Math.random() < 0.7) ||
				(hour === 11 && Math.random() < 0.9) ||
				(hour === 12)
			) {
				await setState({ isSleeping: false });
			}
		}

		if (!state.isSleeping) {
			if (
				(hour === 21 && Math.random() < 0.05) ||
				(hour === 22 && Math.random() < 0.1) ||
				(hour === 23 && Math.random() < 0.2) ||
				(hour === 0 && Math.random() < 0.4) ||
				(hour === 1 && Math.random() < 0.7) ||
				(hour === 2 && Math.random() < 0.9) ||
				(hour === 3)
			) {
				await setState({ isSleeping: true });
			}
		}

		const ojiginekoActivity = state.isSleeping ? 'ojigineko-sleeping' : ojiginekoActivities[Math.floor(Math.random() * ojiginekoActivities.length)];

		if (!state.isSleeping) {
			setState({ location: clamp(state.location + random(-2, 2), 0, 16) });
		}

		await slack.chat.postMessage({
			channel: process.env.CHANNEL_OJIGINEKO,
			username: 'ojigineko',
			icon_emoji: ':pizzacat83:',
			text: `${':void:'.repeat(state.location)}:${ojiginekoActivity}:`,
		});
	});
}
