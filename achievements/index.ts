// @ts-nocheck
let activeModule: any = null;

const getModule = async () => {
	if (activeModule) return activeModule;
	if (process.env.NODE_ENV === 'production') {
		activeModule = await import('./index_production.js');
	} else if (process.env.NODE_ENV === 'test') {
		activeModule = {
			default: async () => {},
			unlock: () => {},
			isUnlocked: () => false,
			increment: () => {},
			get: () => null,
			set: () => {},
			lock: () => {}
		};
	} else {
		activeModule = await import('./index_development.js');
	}
	return activeModule;
};

export const unlock = async (...args: any[]) => {
	const mod = await getModule();
	return mod.unlock(...args);
};

export const isUnlocked = async (...args: any[]) => {
	const mod = await getModule();
	return mod.isUnlocked(...args);
};

export const increment = async (...args: any[]) => {
	const mod = await getModule();
	return mod.increment(...args);
};

export const get = async (...args: any[]) => {
	const mod = await getModule();
	return mod.get(...args);
};

export const set = async (...args: any[]) => {
	const mod = await getModule();
	return mod.set(...args);
};

export const lock = async (...args: any[]) => {
	const mod = await getModule();
	return mod.lock(...args);
};

export default async (...args: any[]) => {
	const mod = await getModule();
	const fn = mod.default || mod;
	return fn(...args);
};
