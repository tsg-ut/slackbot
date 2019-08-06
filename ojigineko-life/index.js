const schedule = require('node-schedule');

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

module.exports = (clients) => {
	const { rtmClient: rtm, webClient: slack } = clients;

	schedule.scheduleJob('30 * * *', async () => {
		const ojiginekoActivity = ojiginekoActivities[Math.floor(Math.random() * ojiginekoActivities.length)];

		await slack.chat.postMessage({
			channel: process.env.CHANNEL_OJIGINEKO,
			username: 'ojigineko',
			icon_emoji: ':pizzacat83:',
			text: `:${ojiginekoActivity}:`,
		});
	});
}
