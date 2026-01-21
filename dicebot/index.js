"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bcdice_1 = require("bcdice");
function unescapeHtml(str) {
    return str.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
class DiceBot {
    slack;
    loader;
    gameSystem;
    constructor({ webClient: slack, eventClient }) {
        this.slack = slack;
        this.loader = new bcdice_1.DynamicLoader();
        eventClient.on("message", async (message) => {
            if (!DiceBot.validateMessage(message))
                return;
            const text = unescapeHtml(message.text);
            if (text.startsWith("@dicebot ")) {
                this.handleCommand(DiceBot.parseCommand(text));
            }
            else {
                await this.handleMessage(text);
            }
        });
    }
    async setGameSystem(systemName) {
        this.gameSystem = await this.loader.dynamicLoad(systemName);
    }
    async sendMessage(text, thread = undefined, channel = process.env.CHANNEL_SANDBOX) {
        return await this.slack.chat.postMessage({
            channel: channel,
            username: "dicebot",
            icon_emoji: ":game_die:",
            text: text,
            thread_ts: thread
        });
    }
    async handleMessage(text) {
        const result = this.gameSystem.eval(text);
        if (result?.text)
            await this.sendMessage(result.text);
    }
    async handleCommand(args) {
        const command = args[0];
        switch (command) {
            case "system":
                if (args.length >= 2) {
                    try {
                        await this.setGameSystem(args[1]);
                        await this.sendMessage(`ゲームシステムを ${this.gameSystem.NAME} にセットしたよ`);
                    }
                    catch (e) {
                        await this.sendMessage(`${args[1]} は知らないゲームシステムだよ\nIDで指定してね\nシステムの一覧は @dicebot list で確認できるよ`);
                    }
                }
                else {
                    await this.sendMessage(`今のゲームシステムは ${this.gameSystem.NAME} だよ`);
                }
                break;
            case "systemhelp":
                await this.sendMessage(this.gameSystem.HELP_MESSAGE);
                break;
            case "list":
                const { ts } = await this.sendMessage(`以下のシステムが指定できるよ\nNAME: ID`);
                await this.sendMessage(DiceBot.getAvailableSystemsString(this.loader), ts);
                break;
            case "help":
                await this.sendMessage(DiceBot.helpMessage());
                break;
            default:
                await this.sendMessage(`知らないコマンドだよ`);
                await this.sendMessage(DiceBot.helpMessage());
                break;
        }
    }
    static helpMessage() {
        return `\
@dicebot help: このヘルプを表示
@dicebot system: 現在のゲームシステムを確認
@dicebot system [system id]: 現在のゲームシステムを変更
@dicebot list: ゲームシステムの一覧を表示
@dicebot systemhelp: 現在のゲームシステムで使えるコマンド一覧
`;
    }
    static parseCommand(text) {
        return text.split(" ").slice(1);
    }
    static validateMessage(message) {
        if (message.channel !== process.env.CHANNEL_SANDBOX)
            return false;
        if (message.subtype === "bot_message")
            return false;
        if (!message.text)
            return false;
        return true;
    }
    static getAvailableSystemsString(loader) {
        return loader
            .listAvailableGameSystems()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((system) => `${system.name}: ${system.id}`)
            .join("\n");
    }
}
exports.default = async (slackInterface) => {
    const diceBot = new DiceBot(slackInterface);
    await diceBot.setGameSystem("DiceBot");
};
