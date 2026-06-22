module.exports = {
	transform: {
		'^.+\\.tsx?$': 'ts-jest',
	},
	moduleNameMapper: {
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