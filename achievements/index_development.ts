export default async () => {};

export const unlock = async (user: string, name: string, additionalInfo?: string) => {
	console.log(`${user} unlocked ${name}${additionalInfo == null ? '' : (', ' + additionalInfo)}`);
};

export const isUnlocked = async () => false;
export const increment = async () => {};
export const get = async (): Promise<any> => null;
export const set = async () => {};
