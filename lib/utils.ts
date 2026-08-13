export class Deferred<T> {
	promise: Promise<T>;
	isResolved: boolean;
	isRejected: boolean;
	private nativeReject: (...args: any[]) => any;
	private nativeResolve: (...args: any[]) => any;

	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.nativeReject = reject;
			this.nativeResolve = resolve;
		});
		this.isResolved = false;
		this.isRejected = false;
	}

	resolve(value: T) {
		this.nativeResolve(value);
		this.isResolved = true;
		return this.promise;
	}

	reject(...args: any[]) {
		this.nativeReject(...args);
		this.isRejected = true;
		return this.promise;
	}
}

/**
 * データを非同期に取得する関数 loader をコンストラクタ引数にとり、load()を呼ぶとloaderの返り値を返すクラス。
 * loaderは1度しか呼ばれないことが保証される。
 */
export class Loader<T> {
	isTriggered: boolean;
	loader: () => Promise<T>;
	private deferred: Deferred<T>;
	private value: T | null;

	constructor(loader: () => Promise<T>) {
		this.loader = loader;
		this.isTriggered = false;
		this.value = null;
		this.deferred = new Deferred<T>();
	}

	load() {
		if (this.isTriggered) {
			return this.deferred.promise;
		}
		this.isTriggered = true;
		this.loader().then((value) => {
			this.value = value;
			this.deferred.resolve(value);
		}, (error) => {
			this.deferred.reject(error);
		});
		return this.deferred.promise;
	}

	clear() {
		this.isTriggered = false;
		this.deferred = new Deferred<T>();
	}

	get() {
		return this.value;
	}
}

/**
 * tsc の esModuleInterop でビルドされた CJS モジュールは `exports.default = X` の形で
 * 本体を持つため、Node のネイティブ ESM ローダー経由で読み込むと default が二重になる。
 * 一方 vitest/tsx (esbuild) は unwrap 済みの値を渡してくるため、どちらでも動くよう
 * default があればそれを、なければモジュールそのものを返す。
 */
export const unwrapDefault = <T>(module: T | {default: T}): T => (
	(module as {default?: T}).default ?? (module as T)
);
