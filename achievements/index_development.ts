export default async () => {};

export const unlock = (user: string, name: string, additionalInfo?: string) => {
	console.log(`${user} unlocked ${name}${additionalInfo === null ? '' : (`, ${additionalInfo}`)}`);
};

export const isUnlocked = () => false;
export const increment = () => {};
export const get = (): any => null;
export const set = () => {};
export const lock = () => {};
