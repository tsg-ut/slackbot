"use strict";
// AlpacaHack
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByNameAH = exports.fetchUserProfileAH = exports.fetchChallsAH = void 0;
const axios_1 = __importDefault(require("axios"));
const client = axios_1.default.create({
    withCredentials: false,
});
const fetchChallsAH = async function () {
    try {
        const { data: json } = await client.get("https://alpacahack.com/challenges?_data=routes%2F_root.challenges", {
            headers: {},
        });
        return json.challenges.map((chall) => ({
            id: "?", // not available
            name: chall.name,
            score: 0, // not available
        }));
    }
    catch {
        return null;
    }
};
exports.fetchChallsAH = fetchChallsAH;
const fetchUserProfileAH = async function (userId) {
    try {
        const { data: json } = await client.get(`https://alpacahack.com/users/${userId}?_data=routes%2F_root.users_.%24userName`, {
            headers: {},
        });
        return {
            username: json.name,
            country: json.country,
            rank: "?",
            score: json.submissions
                .filter((sub) => sub.isCorrect)
                .length.toString(),
            comment: "",
            registeredAt: "", // not available
            solvedChalls: json.submissions
                .filter((sub) => sub.isCorrect)
                .map((sub) => ({
                id: "", // not available
                solvedAt: new Date(sub.createdAt.value),
                name: sub.challenge.name,
                score: 0, // not available
            })),
        };
    }
    catch {
        return null;
    }
};
exports.fetchUserProfileAH = fetchUserProfileAH;
const findUserByNameAH = async function (username) {
    try {
        const { data: json } = await client.get(`https://alpacahack.com/users/${username}?_data=routes%2F_root.users_.%24userName`, {
            headers: {},
        });
        return {
            userid: json.name,
            name: json.name,
        };
    }
    catch {
        return null;
    }
};
exports.findUserByNameAH = findUserByNameAH;
