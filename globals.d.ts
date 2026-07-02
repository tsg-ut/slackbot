declare module "amae-koromo/majsoul" {
  private class MajsoulConnection {
    clientVersionString: string;
    async rpcCall(methodName: string, payload: Record<string, any>): Promise<any>;
    close(): void;
  }

  async function createMajsoulConnection(accessToken: string = ACCESS_TOKEN, preferredServer: string = PREFERRED_SERVER): Promise<MajsoulConnection>;
}

declare module "mp3-duration" {
  function mp3Duration(buffer: Buffer): Promise<number>;
  export = mp3Duration;
}

declare module "japanese" {
  export function hiraganize(str: string): string;
  export function romanize(str: string, config?: Record<string, string>): string;
}

declare module "word2vec" {
  interface Model {
    getVector(word: string): {values: number[]} | null;
    similarity(word1: string, word2: string): number;
    mostSimilar(word: string, n?: number): Array<{word: string; similarity: number}>;
  }
  function loadModel(file: string, callback: (err: Error | null, model: Model) => void): void;
  export {loadModel};
  export default {loadModel};
}
