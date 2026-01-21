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
exports.server = void 0;
const logger_1 = __importDefault(require("../lib/logger"));
const sqlite = __importStar(require("sqlite"));
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const sql_template_strings_1 = __importDefault(require("sql-template-strings"));
const lodash_1 = require("lodash");
const log = logger_1.default.child({ bot: 'oauth' });
const server = ({ webClient: slack }) => async (fastify) => {
    const db = await sqlite.open({
        filename: path_1.default.join(__dirname, '..', 'tokens.sqlite3'),
        driver: sqlite3_1.default.Database,
    });
    await db.run(`
		CREATE TABLE IF NOT EXISTS tokens (
			team_id string PRIMARY KEY,
			team_name string,
			access_token string,
			bot_user_id string,
			bot_access_token string
		)
	`);
    fastify.get('/oauth', async (req, res) => {
        const data = await slack.oauth.v2.access({
            code: req.query.code,
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
        });
        if (!data.ok) {
            res.code(500);
            log.error(data);
            return 'Internal Server Error';
        }
        await db.run((0, sql_template_strings_1.default) `
			INSERT OR REPLACE INTO tokens (
				team_id,
				team_name,
				access_token,
				bot_user_id,
				bot_access_token
			) VALUES (
				${(0, lodash_1.get)(data, ['team_id'], null)},
				${(0, lodash_1.get)(data, ['team_name'], null)},
				${(0, lodash_1.get)(data, ['access_token'], null)},
				${(0, lodash_1.get)(data, ['bot', 'bot_user_id'], null)},
				${(0, lodash_1.get)(data, ['bot', 'bot_access_token'], null)}
			)
		`);
        return 'Successfully installed tsgbot to your workspace';
    });
};
exports.server = server;
