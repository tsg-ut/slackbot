/* eslint-env node, jest */

const scheduleJob = jest.fn(() => ({
	cancel: jest.fn(),
	nextInvocation: jest.fn(() => null),
}));

const cancelJob = jest.fn();
const gracefulShutdown = jest.fn();

module.exports = {scheduleJob, cancelJob, gracefulShutdown};
