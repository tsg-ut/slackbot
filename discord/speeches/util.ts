const escapeXml = (text: string) => {
	return text.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
};

const emphasisTemplate = '<emphasis level="strong"><prosody pitch="+3st">$1</prosody></emphasis>';

export const textToSsml = (text: string, audioTags?: {[id: string]: string}) => {
	let escapedText = escapeXml(text);

	escapedText = escapedText
		.replace(/\*\*(.+?)\*\*/g, emphasisTemplate)
		.replace(/__(.+?)__/g, emphasisTemplate)
		.replace(/\*(.+?)\*/g, emphasisTemplate)
		.replace(/_(.+?)_/g, emphasisTemplate);

	escapedText = escapedText.replaceAll(/\[(.+?)\]/g, (_match, tag) => {
		if (audioTags && audioTags.hasOwnProperty(tag)) {
			return `<audio src="${escapeXml(audioTags[tag])}">${tag}</audio>`;
		}
		return tag;
	});

	// audioタグだけの場合になぜかバグるので0秒のbreakを挿入する
	return `${escapedText}<break time="0ms"/>`;
};