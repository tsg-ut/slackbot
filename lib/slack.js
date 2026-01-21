"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokens = exports.tsgEventClient = exports.messageClient = exports.eventClient = exports.webClient = void 0;
const web_api_1 = require("@slack/web-api");
const interactive_messages_1 = require("@slack/interactive-messages");
const events_api_1 = require("@slack/events-api");
const sql_template_strings_1 = __importDefault(require("sql-template-strings"));
const sqlite = __importStar(require("sqlite"));
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const slackEventClient_1 = require("./slackEventClient");
const eventClientWrapper_1 = require("./eventClientWrapper");
const utils_1 = require("./utils");
;
exports.webClient = new web_api_1.WebClient(process.env.SLACK_TOKEN);
exports.eventClient = new eventClientWrapper_1.EventClientWrapper((0, events_api_1.createEventAdapter)(process.env.SIGNING_SECRET, { includeBody: true }));
exports.messageClient = (0, interactive_messages_1.createMessageAdapter)(process.env.SIGNING_SECRET);
exports.tsgEventClient = new slackEventClient_1.TeamEventClient(exports.eventClient, process.env.TEAM_ID);
const loadTokensDeferred = new utils_1.Deferred();
const loadTokens = async () => {
    const db = await sqlite.open({
        filename: path_1.default.join(__dirname, '..', 'tokens.sqlite3'),
        driver: sqlite3_1.default.Database,
    });
    const tokens = await db.all((0, sql_template_strings_1.default) `SELECT * FROM tokens WHERE bot_access_token <> ''`).catch(() => []);
    await db.close();
    loadTokensDeferred.resolve(tokens.concat([{
            team_id: process.env.TEAM_ID,
            team_name: process.env.TEAMNAME,
            access_token: process.env.HAKATASHI_TOKEN,
            bot_access_token: process.env.SLACK_TOKEN,
            bot_user_id: process.env.USER_TSGBOT,
        }]));
};
loadTokens();
const getTokens = () => loadTokensDeferred.promise;
exports.getTokens = getTokens;
