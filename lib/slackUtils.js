// XXX: このファイルは anime/index.js・hangman/index.js (CJS) がテスト環境で require('../lib/slackUtils') で
// ロードするために存在するスタブ。
// これらのファイルは CJS 形式のため Vite のモジュール解決をバイパスし、Node の CJS ローダーが
// .ts 拡張子を解決できないので、lib/slackUtils.ts の代わりにこの .js スタブが必要になっている。
// プロジェクトの ESM 化（または各 CJS ファイルの TypeScript 化）完了後は必ずこのファイルを削除すること。(#846)

const getMemberName = async () => undefined;
const getMemberIcon = async () => undefined;
const getAllTSGMembers = async () => [];
const getReactions = async () => [];
const isGenericMessage = () => true;
const isHumanMessage = () => true;
const extractMessage = (message) => message;
const plainText = (text) => ({type: 'plain_text', text});
const mrkdwn = (text) => ({type: 'mrkdwn', text});
const getAuthorityLabel = () => '';
const isPlayground = () => false;

module.exports = {
	getMemberName,
	getMemberIcon,
	getAllTSGMembers,
	getReactions,
	isGenericMessage,
	isHumanMessage,
	extractMessage,
	plainText,
	mrkdwn,
	getAuthorityLabel,
	isPlayground,
};
module.exports.default = module.exports;
