import {vi} from 'vitest';

const render = vi.fn(() => (
	Promise.resolve(Buffer.alloc(0x100))
));

export default render;
