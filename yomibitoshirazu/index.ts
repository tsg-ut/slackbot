import { createMessageAdapter } from "@slack/interactive-messages";
import { ChatPostMessageArguments, ChatUpdateArguments, WebClient } from "@slack/web-api";
import { Mutex } from "async-mutex";
import { SlackInterface } from "../lib/slack";
import { TeamEventClient } from "../lib/slackEventClient";
import State from "../lib/state";
import config from "./config";
import instructionYomibitoshirazu from "./views/instructionYomibitoshirazu";
import makeYomibitoshirazuThread from "./views/makeYomibitoshirazuThread";
import waitforGameStart from "./views/waitforGameStart";

export interface YomibitoshirazuGame {
	triggerTs: string;
    threadTses: string[];
	statusTs?: string;
	permalink: string;
	outline: string[];
	outlineAuthor: string;
	pieces: string[];
	pieceAuthors: string[];

	answer?: string;
	answerAuthor?: string;

	num_questions: number;
}

interface YomibitoshirazuState {
	games: YomibitoshirazuGame[];
}

const mutex = new Mutex();

class Yomibitoshirazu {
	webClient: WebClient;
	eventClient: TeamEventClient;
	messageClient: ReturnType<typeof createMessageAdapter>;

    state: YomibitoshirazuState;

    constructor({
		webClient,
		eventClient,
		messageClient,
	}: {
		webClient: WebClient,
		eventClient: TeamEventClient,
		messageClient: ReturnType<typeof createMessageAdapter>,
	}) {
		this.webClient = webClient;
		this.eventClient = eventClient;
		this.messageClient = messageClient;
	}

    async initialize() {
        this.state = await State.init<YomibitoshirazuState>('yomibitoshirazu', {
			games: [],
		});
        this.eventClient.on('message', async (message) => {
			mutex.runExclusive(() => this.onMessage(message));
		});




    }

    async postMessage(message: Partial<ChatPostMessageArguments>) {
		return await this.webClient.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: "詠み人知らず",
			icon_emoji: ":pencil:",
			text: "お使いの環境でこのメッセージは閲覧できないようです。",
			...message,
		});
	}

    getGame(triggerTs: string): YomibitoshirazuGame {
		return this.state.games.find(game => game.triggerTs == triggerTs);
	}


    async onMessage(message: any) {
		if (message.channel !== process.env.CHANNEL_SANDBOX || !message.text) {
			return;
		} else if (message.subtype === 'bot_message' || message.subtype === 'slackbot_response' || message.bot_id) {
			return;
		}
        // message test
        if (message.text === "hoge") {
            this.postMessage({
                text: "hoge"
            });
        }
        
        // non-thread
        // if (message.text.match(config.joinTrigger)) {
        //     let returnValue;
        //     returnValue = await this.makeYomibitoshirazuThread(message);
        //     await this.waitforGameStart(message, returnValue.response_meta.message.ts);
        //     return;
        // }
        if (message.text.match(config.joinTrigger)) {
            await this.tempMakeYomibitoshirazuThread(message);
            return;
        }
        if (message.text.match(config.helpTrigger)) {
			await this.showHelp(message.ts);
			return;
		}

        // in-thread
        const game = this.getGame(message.thread_ts);
        if (!message.thread_ts || !game || game.pieces.some(piece => !piece)) {
			return;
		}
        
    }

    async initiateGame() {

    }

    async showHelp(threadTs: string=null) {
		await this.postMessage({...instructionYomibitoshirazu()});
	}

    async tempMakeYomibitoshirazuThread(message: any) {
        await this.postMessage({thread_ts: message.ts, ...makeYomibitoshirazuThread(message)});
    }

    async makeYomibitoshirazuThread(message: any) {
        await this.postMessage({...makeYomibitoshirazuThread(message)});
        // await this.postMessage({thread_ts: message.ts, ...waitforGameStart(message)});
    }

    async waitforGameStart(message: any, ts: string) {
        // await this.postMessage({...makeYomibitoshirazuThread(message)});
        await this.postMessage({thread_ts: ts, ...waitforGameStart(message)});
    }

    

    // async postEphemeral(user: string, message: Partial<ChatPostEphemeralArguments>) {
    //     return await this.webClient.chat.postEphemeral({
    //         channel: process.env.CHANNEL_SANDBOX,
	// 		username: "読み人知らず",
	// 		icon_emoji: ":pencil:",
    //         user,
	// 		text: "お使いの環境でこのメッセージは閲覧できないようです。",
	// 		...message,
    //     })
    // }

    
};

export default async ({webClient, messageClient, eventClient}: SlackInterface) => {
	const yomibitoshirazu = new Yomibitoshirazu({webClient, messageClient, eventClient});
	await yomibitoshirazu.initialize();
};




// if (message.text === "hoge") {
//     this.postMessage({
//         text: "hoge"
//     });
// }
// if (message.text === "ephemeral") {
//     this.postEphemeral(
//         message.user,
//         {
//             text: "えふぇめらる"
//         }
//     )
// }
// }

// async postMessage(message: Partial<ChatPostMessageArguments>) {
// return await this.webClient.chat.postMessage({
//     channel: process.env.CHANNEL_SANDBOX,
//     username: "詠み人知らず",
//     icon_emoji: ":pencil:",
//     text: "お使いの環境でこのメッセージは閲覧できないようです。",
//     ...message,
// });
// }

// async postEphemeral(user: string, message: Partial<ChatPostEphemeralArguments>) {
// return await this.webClient.chat.postEphemeral({
//     channel: process.env.CHANNEL_SANDBOX,
//     username: "読み人知らず",
//     icon_emoji: ":pencil:",
//     user,
//     text: "お使いの環境でこのメッセージは閲覧できないようです。",
//     ...message,
// })
// }