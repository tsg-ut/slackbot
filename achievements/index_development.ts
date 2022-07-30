import logger from '../lib/logger';

export default async () => {};

export const unlock = (user: string, name: string, additionalInfo?: string) => {
	logger.debug(`${user} unlocked ${name}${additionalInfo ? `, ${additionalInfo}` : ''}`);
};
export const isUnlocked = () => false;
export const increment = (user: string, name: string, value: number = 1) => {
	logger.debug(`${user} increased ${name} by ${value}`);
};
export const get = (): any => null;
export const set = (user: string, name: string, value: any) => {
	logger.debug(`${user} set ${name} = ${value}`);
};
export const lock = () => {};
