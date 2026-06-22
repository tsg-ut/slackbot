module.exports = {
	transform: {
		'^.+\\.tsx?$': 'ts-jest',
	},
	moduleNameMapper: {
		// @octokit/webhooks v14 はESM専用パッケージのためJest（CJS環境）では動作しない。
		// CJSで書いたラッパーにマッピングして回避する。
		'^@octokit/webhooks$': '<rootDir>/__mocks__/@octokit/webhooks.cjs',
	},
	testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.[tj]s$',
	collectCoverageFrom: [
		'**/*.{js,ts}',
		'!**/*.test.{js,ts}',
	],
	coveragePathIgnorePatterns: [
		'bin',
		'coverage',
		'/node_modules/',
	],
};