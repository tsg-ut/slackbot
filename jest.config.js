module.exports = {
	transform: {
		'^.+\\.tsx?$': 'ts-jest',
	},
	testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.[tj]s$',
	testPathIgnorePatterns: [
		'/node_modules/',
		'/.build/',
	],
	modulePathIgnorePatterns: [
		'<rootDir>/.build/',
	],
	collectCoverageFrom: [
		'**/*.{js,ts}',
		'!**/*.test.{js,ts}',
	],
	coveragePathIgnorePatterns: [
		'bin',
		'coverage',
		'/node_modules/',
		'/.build/',
	],
};