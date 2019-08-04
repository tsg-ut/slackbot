export interface Message {
    text?: string;
    subtype?: string;
    channel: string;
    ts: string;
    user?: string;
    bot_id?: string;
};