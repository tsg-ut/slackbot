import logger from '../lib/logger';

export default async () => {};

export const unlock = (user: string, name: string, additionalInfo?: string) => {
	logger.debug(`${user} unlocked ${name}${additionalInfo ? `, ${additionalInfo}` : ''}`);
};

export const isUnlocked = () => false;
export const increment = () => {};
export const get = (): any => null;
export const set = () => {};
export const lock = () => {};
