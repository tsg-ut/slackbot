"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lock = exports.set = exports.get = exports.increment = exports.isUnlocked = exports.unlock = void 0;
const logger_1 = __importDefault(require("../lib/logger"));
const log = logger_1.default.child({ bot: 'achievements' });
exports.default = async () => { };
const unlock = (user, name, additionalInfo) => {
    log.debug(`${user} unlocked ${name}${additionalInfo ? `, ${additionalInfo}` : ''}`);
};
exports.unlock = unlock;
const isUnlocked = () => false;
exports.isUnlocked = isUnlocked;
const increment = (user, name, value = 1) => {
    log.debug(`${user} increased ${name} by ${value}`);
};
exports.increment = increment;
const get = () => null;
exports.get = get;
const set = (user, name, value) => {
    log.debug(`${user} set ${name} = ${value}`);
};
exports.set = set;
const lock = () => { };
exports.lock = lock;
