const tinyreq = (...args) => (
	tinyreq.impl(...args)
);

tinyreq.impl = vi.fn(() => {
	return Promise.resolve(tinyreq.response);
});

tinyreq.response = '';

export default tinyreq;
