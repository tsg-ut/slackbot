"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMajsoulId = exports.getMajsoulResult = void 0;
const majsoul_1 = require("amae-koromo/majsoul");
const getMajsoulLog = async (id) => {
    const connection = await (0, majsoul_1.createMajsoulConnection)();
    const resp = await connection.rpcCall('.lq.Lobby.fetchGameRecord', {
        game_uuid: id,
        client_version_string: connection.clientVersionString,
    });
    connection.close();
    return resp.head;
};
const getMajsoulResult = async (id) => {
    const record = await getMajsoulLog(id);
    if (record === null) {
        return { players: null, date: null };
    }
    const players = (record?.result?.players || []).map((player) => ({
        seat: player.seat,
        score: player.part_point_1,
        point: player.total_point,
        accountId: record.accounts.find(({ seat }) => player.seat === seat)?.account_id || 0,
        nickname: record.accounts.find(({ seat }) => player.seat === seat)?.nickname || 'CPU',
    }));
    players.sort((a, b) => b.point - a.point);
    return { players, date: new Date(record.start_time * 1000) };
};
exports.getMajsoulResult = getMajsoulResult;
const extractMajsoulId = (text) => {
    const urlTexts = text.match(/https?:\/\/game\.mahjongsoul\.com\/\?paipu=\S+/);
    if (!urlTexts) {
        return null;
    }
    const url = new URL(urlTexts?.[0]);
    const paipu = new URLSearchParams(url.search).get('paipu');
    if (!paipu) {
        return null;
    }
    return paipu.split('_')[0];
};
exports.extractMajsoulId = extractMajsoulId;
