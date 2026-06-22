'use strict';

const {createHmac, timingSafeEqual} = require('crypto');

class Webhooks {
	constructor(options) {
		this.secret = options?.secret;
	}

	async verify(payload, signature) {
		if (!this.secret || !signature) return false;
		const sig = 'sha256=' + createHmac('sha256', this.secret).update(payload).digest('hex');
		const sigBuf = Buffer.from(sig);
		const sigToCheckBuf = Buffer.from(signature);
		if (sigBuf.length !== sigToCheckBuf.length) return false;
		return timingSafeEqual(sigBuf, sigToCheckBuf);
	}
}

module.exports = {Webhooks};
