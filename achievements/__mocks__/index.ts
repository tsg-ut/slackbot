import {vi} from 'vitest';

export default vi.fn(async () => {});

export const unlock = vi.fn((user: string, name: string, additionalInfo?: string) => {
	console.log(`[achievements stub] ${user} unlocked ${name}${additionalInfo ? `, ${additionalInfo}` : ''}`);
});
export const isUnlocked = vi.fn(() => false);
export const increment = vi.fn((user: string, name: string, value: number = 1) => {
	console.log(`[achievements stub] ${user} increased ${name} by ${value}`);
});
export const get = vi.fn((): unknown => null);
export const set = vi.fn((user: string, name: string, value: unknown) => {
	console.log(`[achievements stub] ${user} set ${name} = ${value}`);
});
export const lock = vi.fn(() => {});
