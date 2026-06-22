/* eslint-env node, jest */

class Storage {
	constructor() {
		this.storage = new Map(Object.entries(nodePersist.storage));
	}

	getItem(key) {
		return Promise.resolve(this.storage.get(key));
	}

	setItem(key, value) {
		return Promise.resolve(this.storage.set(key, value));
	}

	init() {
		return;
	}
}

const nodePersist = {
	create: () => new Storage(),
};

nodePersist.storage = {};

module.exports = nodePersist;
