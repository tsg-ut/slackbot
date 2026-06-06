module.exports = {
	transform: {
		'^.+\\.tsx?$': 'ts-jest',
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
	moduleNameMapper: {
		'^node-schedule$': '<rootDir>/__mocks__/node-schedule.js',
		'^dockerode$': '<rootDir>/__mocks__/dockerode.js',
		'^download$': '<rootDir>/__mocks__/download.js',
	},
};