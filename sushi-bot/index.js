const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const schedule = require('node-schedule');
const {sortBy} = require('lodash');
const moment = require('moment');
const {unlock, increment} = require('../achievements');

class Counter {
	constructor(name) {
		this.name = name;
		this.map = new Map();
		this.load();
	}

	add(key, cnt = 1) {
		if (this.map.has(key)) {
			this.map.set(key, this.map.get(key) + cnt);
		} else {
			this.map.set(key, cnt);
		}

		this.save();
	}

	max(key, value) {
		if (this.map.has(key)) {
			this.map.set(key, Math.max(value, this.map.get(key)));
		} else {
			this.map.set(key, value);
		}

		this.save();
	}

	clear() {
		this.map = new Map();
		this.save();
	}

	entries() {
		const keys = Array.from(this.map.keys());
		const sortedKeys = sortBy(keys, (key) => this.map.get(key)).reverse();
		return sortedKeys.map((key) => [key, this.map.get(key)]);
	}

	async save() {
		const filePath = path.join(__dirname, `${this.name}.json`);
		await promisify(fs.writeFile)(filePath, JSON.stringify(Array.from(this.map.entries())));
	}

	async load() {
		const filePath = path.join(__dirname, `${this.name}.json`);

		const exists = await new Promise((resolve) => {
			fs.access(filePath, fs.constants.F_OK, (error) => {
				resolve(!Boolean(error));
			});
		});

		if (exists) {
			const data = await promisify(fs.readFile)(filePath);
			this.map = new Map(JSON.parse(data));
		} else {
			this.map = new Map();
		}
	}
}

function count(haystack, needle) {
	return haystack.split(needle).length - 1;
}

function numToEmoji(num) {
	switch(num) {
		case 0:
			return 'zero';
		case 1:
			return 'one';
		case 2:
			return 'two';
		case 3:
			return 'three';
		case 4:
			return 'four';
		case 5:
			return 'five';
		case 6:
			return 'six';
		case 7:
			return 'seven';
		case 8:
			return 'eight';
		case 9:
			return 'nine';
		case 10:
			return 'keycap_ten';
		default:
			return 'vsonline';
	}
}

module.exports = (clients) => {
	const { rtmClient: rtm, webClient: slack } = clients;

	const sushiCounter = new Counter('sushi');
	const suspendCounter = new Counter('suspend');
	const dailyAsaCounter = new Counter('dailyAsa');
	const weeklyAsaCounter = new Counter('asa');
	const dailyexerciseCounter = new Counter('dailyexercise');
	const exerciseCounter = new Counter('exercise');

	rtm.on('message', async (message) => {
		const { channel, text, user, ts: timestamp } = message;
		if (!text) {
			return;
		}

		if (message.channel.startsWith('D')) {
			const postDM = (text) => (
				slack.chat.postMessage({
					channel: message.channel,
					text,
					username: 'sushi-bot',
					// eslint-disable-next-line camelcase
					icon_emoji: ':sushi:',
				})
			);

			const tokens = text.trim().split(/\s+/);

			if (tokens[0] === '寿司ランキング' && tokens[1] === '確認') {
				let currentRank = 1;
				for (let entry of sushiCounter.entries()) {
					if (entry[0] === user) {
						return postDM(`あなたのすし数は${entry[1]}個、現在の順位は${currentRank}位`);
					}
					currentRank++;
				}
			}

			if (tokens[0] === '凍結ランキング' && tokens[1] === '確認') {
				let currentRank = 1;
				for (let entry of suspendCounter.entries()) {
					if (entry[0] === user) {
						return postDM(`あなたの凍結回数は${entry[1]}回、現在の順位は${currentRank}位`);
					}
					currentRank++;
				}
			}

			if (tokens[0] === '起床ランキング' && tokens[1] === '確認') {
				const total = new Map(weeklyAsaCounter.entries());
				dailyAsaCounter.entries().map(([user, score]) => {
					if (!total.has(user)) {
						total.set(user, 0);
					}
					total.set(user, score + total.get(user));
				});
				const scores = Array.from(total.entries()).sort(([u1, s1], [u2, s2]) => s2 - s1);
				const index = scores.findIndex(([u, _]) => u === user);
				postDM(`あなたの起床点数は${scores[index][1]}点、現在の順位は${index + 1}位`);
			}

			if (tokens[0] === 'エクササイズランキング' && tokens[1] === '確認') {
				let currentRank = 1;
				for (let entry of exerciseCounter.entries()) {
					if (entry[0] === user) {
						return postDM(`あなたのエクササイズ回数は${entry[1]}回、現在の順位は${currentRank}位`);
					}
					currentRank++;
				}
			}
		}

		{
			const rtext = text.
				replace(/鮨/g, 'すし').
				replace(/(su|zu|[スズず寿壽])/gi, 'す').
				replace(/(sh?i|ci|[しシ司\u{0328}])/giu, 'し');
			const cnt = count(rtext, 'すし');

			if (cnt >= 1) {
				Promise.resolve()
					.then(() => slack.reactions.add({name: 'sushi', channel, timestamp}))
					.then(() =>
						cnt >= 2 &&
						Promise.resolve()
						.then(() => slack.reactions.add({name: 'x', channel, timestamp}))
						.then(() => slack.reactions.add({name: numToEmoji(cnt), channel, timestamp}))
					);

				if (channel.startsWith('C')) {
					sushiCounter.add(user, cnt);

					switch (true) {
						case cnt > 10:
							unlock(user, 'get-infinite-sushi');
						case cnt >= 2:
							unlock(user, 'get-multiple-sushi');
						case cnt >= 1:
							unlock(user, 'get-sushi');
					}

					if (moment().utcOffset(9).day() === 3) {
						unlock(user, 'wednesday-sushi');
					}
				}
			}
		}

		{
			const rtext = text.
				replace(/(ca|(ke|け|ケ)(i|ぃ|い|ｨ|ィ|ｲ|イ|e|ぇ|え|ｪ|ェ|ｴ|エ|-|ー))(ki|ke|き|キ)/gi, 'ケーキ');

			if (rtext.includes("ケーキ")) {
				slack.reactions.add({name: 'cake', channel, timestamp});
			}
		}

		{
			const chians = ["殺", "死", ":korosuzo:"];

			const cnt = chians.reduce((sum, cur) => sum + count(text, cur), 0);

			if(cnt >= 1) {
				Promise.resolve()
					.then(() => slack.reactions.add({name: 'no_good', channel, timestamp}))
					.then(() => slack.reactions.add({name: 'cookies146', channel, timestamp}))
					.then(() =>
						cnt >= 2 &&
						Promise.resolve()
						.then(() => slack.reactions.add({name: 'x', channel, timestamp}))
						.then(() => slack.reactions.add({name: numToEmoji(cnt), channel, timestamp}))
					);

				if (channel.startsWith('C')) {
					unlock(user, 'freezing');

					suspendCounter.add(user, cnt);
				}
			}
		}

		{
			const rtext = text.
				replace(/akouryyy/gi, 'akkoury').
				replace(/akouryy/gi, '').
				replace(/kk/gi, 'k').
				replace(/rr/gi, 'r').
				replace(/y/gi, 'yy');

			if (rtext.includes("akouryy")) {
				slack.reactions.add({name: 'no_good', channel, timestamp});
				slack.reactions.add({name: 'akouryy', channel, timestamp});
			}
		}

		{
			const stars = ["欲し", "干し", "ほし", "星", "★", "☆"];
			for(const star of stars) {
				if (text.includes(star)) {
					slack.reactions.add({name: 'grapes', channel, timestamp});
					break;
				}
			}
		}

		{
			const rtext = text.
				replace(/\s/gi,'').
				replace(/ｻ|サ|:(ahokusa|hokusai)-bottom-left:/gi,'さ').
				replace(/ｱ|ア|:(ahokusa|hokusai)-top-right:/gi,'あ').
				replace(/朝/gi,'あさ').
				replace(/!|！|:exclamation:|:heavy_exclamation_mark:|:grey_exclamation:|:bangbang:/gi,'！').
				replace(/sa/gi,'さ').
				replace(/a/gi,'あ');

			if(rtext.match(/^あ+さ！*$/)){
				const now = moment().utcOffset('+0900');
				const decimal_hour = now.hour() + now.minutes() / 60 + now.seconds() / 3600;
				// 6時から9時の間で100点以上をとるサインカーブ
				const score_curve = (t) => Math.cos((t - (6 + 9) / 2) / 24 * 2 * Math.PI);
				const decimal_score = score_curve(decimal_hour) / score_curve(9) * 100 ;
				const score_names = {
					'0ten':  0,
					'5ten':  5,
					'20':   20,
					'50':   50,
					'80':   80,
					'95':   95,
					'100': 100,
					'108': 108,
				};
				let best_score = 0;
				let best_name = "0ten";
				for(const name in score_names){
					const score = score_names[name];
					if(decimal_score >= score && score > best_score){
						best_score = score;
						best_name = name;
					}
				}
				if (best_score > 0) {
					unlock(user, 'asa');
				}
				if (best_score >= 80) {
					unlock(user, 'asa-over80');
				}
				slack.reactions.add({name: best_name, channel, timestamp});
				dailyAsaCounter.max(user, best_score);
			}
		}

		{
			if(text.includes(":exercise-done:")||text.includes(":kintore_houkoku:")){
				await increment(user, 'exercise-cumulative');
				Promise.resolve()
				.then(() => slack.reactions.add({name: 'erai', channel, timestamp}))
				.then(() => slack.reactions.add({name: 'sugoi', channel, timestamp}))
	
				if (channel.startsWith('C')) {
					unlock(user, 'first-exercise');
					
					dailyexerciseCounter.add(user, 1);
				}
			}
		}
	});

	schedule.scheduleJob('0 19 * * *', async (date) => {
		dailyAsaCounter.entries().map(([user, score]) => {
			weeklyAsaCounter.add(user, score);
		});
		dailyAsaCounter.clear();
		dailyexerciseCounter.entries().map(([user, score]) => {
			exerciseCounter.add(user, score);
		});
		dailyexerciseCounter.clear();

		// on Sundays
		if (date.getDay() === 0) {
			const {members} = await slack.users.list();

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				username: 'sushi-bot',
				text: '今週の凍結ランキング',
				icon_emoji: ':cookies146:',
				attachments: suspendCounter.entries().map(([user, count], index) => {
					const member = members.find(({id}) => id === user);
					if (!member) {
						return null;
					}
					const name = member.profile.display_name || member.name;
					if (index === 0) {
						unlock(user, 'freezing-master');
					}

					return {
						author_name: `${index + 1}位: ${name} (${count}回)`,
						author_icon: member.profile.image_24,
					};
				}).filter((attachment) => attachment !== null),
			});

			suspendCounter.clear();

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				username: 'sushi-bot',
				text: '今週の寿司ランキング',
				icon_emoji: ':sushi:',
				attachments: sushiCounter.entries().map(([user, count], index) => {
					const member = members.find(({id}) => id === user);
					if (!member) {
						return null;
					}
					const name = member.profile.display_name || member.name;

					return {
						author_name: `${index + 1}位: ${name} (${count}回)`,
						author_icon: member.profile.image_24,
					};
				}).filter((attachment) => attachment !== null),
			});

			sushiCounter.clear();

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				username: 'sushi-bot',
				text: '今週の起床ランキング',
				icon_emoji: ':sunrise:',
				attachments: weeklyAsaCounter.entries().map(([user, count], index) => {
					const member = members.find(({id}) => id === user);
					if (!member) {
						return null;
					}
					const name = member.profile.display_name || member.name;
					if (index === 0 && weeklyAsaCounter.entries().filter(([, c]) => c === count).length === 1) {
						unlock(user, 'asa-master');
					}
					if (count >= 720) {
						unlock(user, 'asa-week-720');
					}

					return {
						author_name: `${index + 1}位: ${name} (${count}点)`,
						author_icon: member.profile.image_24,
					};
				}).filter((attachment) => attachment !== null),
			});

			weeklyAsaCounter.clear();

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				username: 'exercise-bot',
				text: '今週のエクササイズランキング',
				icon_emoji: ':muscle:',
				attachments: exerciseCounter.entries().map(([user, count], index) => {
					const member = members.find(({id}) => id === user);
					if (!member) {
						return null;
					}
					const name = member.profile.display_name || member.name;
					if (count === 7) {
						unlock(user, 'everyday-exercise-week');
					}

					return {
						author_name: `${index + 1}位: ${name} (${count}回)`,
						author_icon: member.profile.image_24,
					};
				}).filter((attachment) => attachment !== null),
			});

			exerciseCounter.clear();
		}
	});
}
