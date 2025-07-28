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
