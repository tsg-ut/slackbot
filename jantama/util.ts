import {createMajsoulConnection} from 'amae-koromo/majsoul';
import type {lq} from 'amae-koromo/majsoulPb';

export interface Player {
	accountId: number,
	nickname: string,

	/** 順位 (0-indexed) */
	seat: number,

	/** 素点 */
	score: number,

	/** ウマ込の素点 */
	point: number,
}

const getMajsoulLog = async (id: string) => {
	const connection = await createMajsoulConnection();
	const resp = await connection.rpcCall('.lq.Lobby.fetchGameRecord', {
		game_uuid: id,
		client_version_string: connection.clientVersionString,
	});
	connection.close();

	return resp.head as lq.RecordGame;
};

export const getMajsoulResult = async (id: string) => {
	const record = await getMajsoulLog(id);

	if (record === null) {
		return {players: null, date: null};
	}

	const players = (record?.result?.players || []).map((player) => ({
		seat: player.seat,
		score: player.part_point_1,
		point: player.total_point,
		accountId: record.accounts.find(({seat}) => player.seat === seat)?.account_id || 0,
		nickname: record.accounts.find(({seat}) => player.seat === seat)?.nickname || 'CPU',
	} as Player));

	players.sort((a, b) => b.point - a.point);

	return {players, date: new Date(record.start_time * 1000)};
};

export const extractMajsoulId = (text: string) => {
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
