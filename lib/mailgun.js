"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mailgun_js_1 = __importDefault(require("mailgun.js"));
const mailgun = new mailgun_js_1.default(FormData);
const mg = mailgun.client({
    username: process.env.MAILGUN_USERNAME,
    key: process.env.MAILGUN_API_KEY,
});
exports.default = mg;
