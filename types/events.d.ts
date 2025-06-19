// Fix for EventEmitter types in TypeScript 5
declare module "node:events" {
  export class EventEmitter {
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: string | symbol, ...args: any[]): boolean;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string | symbol): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    addListener(event: string | symbol, listener: (...args: any[]) => void): this;
    prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
    prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
    listeners(event: string | symbol): Function[];
    rawListeners(event: string | symbol): Function[];
    listenerCount(event: string | symbol): number;
    eventNames(): Array<string | symbol>;
  }
}

declare module "events" {
  export class EventEmitter {
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: string | symbol, ...args: any[]): boolean;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string | symbol): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    addListener(event: string | symbol, listener: (...args: any[]) => void): this;
    prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
    prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
    listeners(event: string | symbol): Function[];
    rawListeners(event: string | symbol): Function[];
    listenerCount(event: string | symbol): number;
    eventNames(): Array<string | symbol>;
  }
}
