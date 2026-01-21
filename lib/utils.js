"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Loader = exports.Deferred = void 0;
class Deferred {
    promise;
    isResolved;
    isRejected;
    nativeReject;
    nativeResolve;
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.nativeReject = reject;
            this.nativeResolve = resolve;
        });
        this.isResolved = false;
        this.isRejected = false;
    }
    resolve(value) {
        this.nativeResolve(value);
        this.isResolved = true;
        return this.promise;
    }
    reject(...args) {
        this.nativeReject(...args);
        this.isRejected = true;
        return this.promise;
    }
}
exports.Deferred = Deferred;
/**
 * データを非同期に取得する関数 loader をコンストラクタ引数にとり、load()を呼ぶとloaderの返り値を返すクラス。
 * loaderは1度しか呼ばれないことが保証される。
 */
class Loader {
    isTriggered;
    loader;
    deferred;
    value;
    constructor(loader) {
        this.loader = loader;
        this.isTriggered = false;
        this.value = null;
        this.deferred = new Deferred();
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
        this.deferred = new Deferred();
    }
    get() {
        return this.value;
    }
}
exports.Loader = Loader;
