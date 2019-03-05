export default class Mutex {
  private locked = false;

  private resolves: Array<(unlock: () => void) => void> = [];

  public lock() {
    const promise = new Promise<() => void>((resolve) => {
      this.resolves.push(resolve);
    });
    this.execNext();
    return promise;
  }
  public async exec<T>(proc: () => Promise<T>) {
    const unlock = await this.lock();
    try {
      return await proc();
    } finally {
      unlock();
    }
  }

  private execNext() {
    if (this.locked) {
      return;
    }
    if (this.resolves.length === 0) {
      return;
    }
    this.locked = true;
    const resolve = this.resolves.shift();
    let unlocked = false;
    const unlock = () => {
      if (unlocked) {
        return;
      }
      this.locked = false;
      unlocked = true;
      this.execNext();
    };
    resolve(unlock);
  }
}
