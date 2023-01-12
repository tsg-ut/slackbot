const escapeXml = (text: string) => {
	return text.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
};

const emphasisTemplate = '<emphasis level="strong"><prosody pitch="+3st">$1</prosody></emphasis>';

export const textToSsml = (text: string) => {
	let escapedText = escapeXml(text);

	escapedText = escapedText
		.replace(/\*\*(.+?)\*\*/g, emphasisTemplate)
		.replace(/__(.+?)__/g, emphasisTemplate)
		.replace(/\*(.+?)\*/g, emphasisTemplate)
		.replace(/_(.+?)_/g, emphasisTemplate);

	return escapedText;
};