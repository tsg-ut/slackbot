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
