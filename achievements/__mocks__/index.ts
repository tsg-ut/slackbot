export default async () => {};

export const unlock = (user: string, name: string, additionalInfo?: string) => {
	console.log(`[achievements stub] ${user} unlocked ${name}${additionalInfo ? `, ${additionalInfo}` : ''}`);
};
export const isUnlocked = () => false;
export const increment = (user: string, name: string, value: number = 1) => {
	console.log(`[achievements stub] ${user} increased ${name} by ${value}`);
};
export const get = (): any => null;
export const set = (user: string, name: string, value: any) => {
	console.log(`[achievements stub] ${user} set ${name} = ${value}`);
};
export const lock = () => {};
