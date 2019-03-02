/* eslint-env node, jest */

const render = jest.fn(() => (
	Promise.resolve(Buffer.alloc(0x100))
));

module.exports = render;
