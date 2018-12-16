const moment = require('moment');
const {
	getPageTitle,
} = require('./lib.js');

module.exports.serialize = ({battles, offset}, members) => {
	const entries = [];

	const getMemberName = (user) => {
		const member = members.find(({id}) => id === user);
		return member.profile.display_name || member.name;
	};

	for (const [index, {timestamp, theme, word, meanings, url, author, sourceString}] of battles.entries()) {
		const users = meanings.filter(({type}) => type === 'user').map(({user}) => user);

		entries.push(`
			# 第${offset + index + 1}回 「**${theme}**」

			* **日時** ${moment(timestamp).utcOffset('+0900').format('YYYY-MM-DD HH:mm:ss')}
			* **参加者** ${users.map((user) => `@${getMemberName(user)}`).join(' ')} (${users.length}人)
			${author ? `* **出題者**: @${getMemberName(author)}` : ''}

			${meanings.map((meaning, i) => `${i + 1}. ${meaning.text}`).join('\n')}

			<details>

			<summary>答え</summary>

			${meanings.map((meaning, i) => {
		let text = '';
		if (meaning.type === 'user') {
			text = `${i + 1}. ${meaning.text} (@${getMemberName(meaning.user)})`;
		} else if (meaning.type === 'dummy') {
			text = `${i + 1}. ${meaning.text} (${meaning.source}: ${meaning.title})`;
		} else if (meaning.type === 'correct') {
			text = `${i + 1}. ⭕️**${meaning.text}**`;
		}

		const betters = meaning.betters.map(({user, coins}) => `@${getMemberName(user)} (${coins}枚)`).join(' ');

		if (betters.length > 0) {
			return `${text}\n    * ${betters}`;
		}

		return text;
	}).join('\n')}

			出典: [${sourceString ? `${word} - ${sourceString}` : getPageTitle(url)}](${url})

			</details>
		`.replace(/^\t+/gm, ''));
	}

	return entries.join('\n');
};
