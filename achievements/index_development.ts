import logger from '../lib/logger.js';

const log = logger.child({bot: 'achievements'});

export default async () => {};

export const unlock = (user: string, name: string, additionalInfo?: string) => {
	log.debug(`${user} unlocked ${name}${additionalInfo ? `, ${additionalInfo}` : ''}`);
};
export const isUnlocked = () => false;
export const increment = (user: string, name: string, value: number = 1) => {
	log.debug(`${user} increased ${name} by ${value}`);
};
export const get = (): any => null;
export const set = (user: string, name: string, value: any) => {
	log.debug(`${user} set ${name} = ${value}`);
};
export const lock = () => {};
