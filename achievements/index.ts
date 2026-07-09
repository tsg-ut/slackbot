// NODE_ENV に応じて production/development 実装を出し分ける。CJS 時代は
// require() で分岐後に読み込むモジュールを限定していたため、同じく
// 使わない側の実装(特に production 側の firebase-admin 等の重い初期化)を
// 評価しないよう、動的 import で分岐する。
const impl = process.env.NODE_ENV === 'production'
	? await import('./index_production.js')
	: process.env.NODE_ENV === 'test'
		? {
			default: async (): Promise<void> => {},
			unlock: (): void => {},
			isUnlocked: (): boolean => false,
			increment: (): void => {},
			get: (): unknown => null,
			set: (): void => {},
			lock: (): void => {},
		}
		: await import('./index_development.js');

export default impl.default;
export const unlock = impl.unlock;
export const isUnlocked = impl.isUnlocked;
export const increment = impl.increment;
export const get = impl.get;
export const set = impl.set;
export const lock = impl.lock;
