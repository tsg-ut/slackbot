const moment = require('moment');
const {
	getPageTitle,
} = require('./lib.js');

module.exports.serialize = ({battles, offset}, members) => {
	const entries = [];

	const getMemberName = (user) => {
		if (user === 'tahoiyabot-01') {
			return 'たほいやAIくん1号 (仮)';
		}

		if (user === 'tahoiyabot-02') {
			return 'たほいやAIくん2号 (仮)';
		}

		const member = members.find(({id}) => id === user);
		return `@${member.profile.display_name || member.name}`;
	};

	for (const [index, {timestamp, theme, word, meanings, url, author, sourceString, comments = []}] of battles.entries()) {
		const users = meanings.filter(({type}) => type === 'user').map(({user}) => user);
		const meaningsText = meanings.map((meaning, i) => {
			let text = '';
			if (meaning.type === 'user') {
				text = `${i + 1}. ${meaning.text} (${getMemberName(meaning.user)})`;
			} else if (meaning.type === 'dummy') {
				text = `${i + 1}. ${meaning.text} (${meaning.source}: ${meaning.title})`;
			} else if (meaning.type === 'correct') {
				text = `${i + 1}. ⭕️**${meaning.text}**`;
			}

			const betters = meaning.betters.map(({user, coins}) => `${getMemberName(user)} (${coins}枚)`).join(' ');

			if (betters.length > 0) {
				return `${text}\n    * ${betters}`;
			}

			return text;
		}).join('\n');
		const commentsText = comments.map((comment) => (
			`* [${moment(comment.date).utcOffset('+0900').format('HH:mm:ss')}] **${getMemberName(comment.user)}** ${comment.text}`
		)).join('\n');

		entries.push(`
			# 第${offset + index + 1}回 「**${theme}**」

			* **日時** ${moment(timestamp).utcOffset('+0900').format('YYYY-MM-DD HH:mm:ss')}
			* **参加者** ${users.map((user) => `${getMemberName(user)}`).join(' ')} (${users.length}人)
			${author ? `* **出題者** ${getMemberName(author)}` : ''}

			${meanings.map((meaning, i) => `${i + 1}. ${meaning.text}`).join('\n')}

			<details>

			<summary>答え</summary>

			${meaningsText}

			出典: [${sourceString ? `${word} - ${sourceString}` : getPageTitle(url)}](${url})

			${commentsText && `## コメント\n\n${commentsText}`}

			</details>
		`.replace(/^\t+/gm, ''));
	}

	return entries.join('\n');
};

/*
(async () => {
	const data = await download('https://gist.github.com/hakatashi/a98baf571a8a448699db08fd29819b8f/raw/3ff758c4d5e2d472a6fe450aa19c0be9fba18e57/tahoiya-1-data.json');
	const {members} = require('../users.json');
	logger.info(module.exports.serialize(JSON.parse(data), members));
})();
*/
