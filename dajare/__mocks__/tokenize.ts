// @ts-nocheck
const tokenize: any = vi.fn((text) => (
	// eslint-disable-next-line no-prototype-builtins
	Promise.resolve(tokenize.virtualTokens.hasOwnProperty(text) ? tokenize.virtualTokens[text] : [])
));

tokenize.virtualTokens = {};

export default tokenize;
