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
 * 指定された channelID のチャンネルがゲームの起動を意図されたチャンネルかどうかを判定する
 */
export function isPlayground(channelId: string) {
  const playgroundChannels = [
    process.env.CHANNEL_SANDBOX,
    process.env.CHANNEL_GAMES,
  ];
  return playgroundChannels.includes(channelId);
}
