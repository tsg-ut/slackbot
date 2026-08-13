import riichiCore from '@hakatashi/riichi-core';
const {Pai, decomp} = riichiCore;
import Agari from '@hakatashi/riichi-core/src/agari.js';
import tenhou6 from '@hakatashi/riichi-core/src/tenhou6.js';

const paiIndices = [
	'1z', '2z', '3z', '4z', '7z', '6z', '5z',
	'1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m',
	'1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s',
	'1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p',
];

const 牌ToPai = (牌, {no赤牌 = false} = {}) => {
	if (!no赤牌) {
		if (牌 === '🀋\uFE00') {
			return Pai['0m'];
		}

		if (牌 === '🀔\uFE00') {
			return Pai['0s'];
		}

		if (牌 === '🀝\uFE00') {
			return Pai['0p'];
		}
	}

	return Pai[paiIndices[牌.codePointAt(0) - 0x1F000]];
};

export const agari = (牌s, {isHaitei = false, isVirgin = false, isRiichi = false, isDoubleRiichi = false, isIppatsu = false, isRon = false, doraHyouji = [], uraDoraHyouji = [], additionalDora = 0}) => {
	const pais = 牌s.map((牌) => 牌ToPai(牌));
	const paisWithout赤牌 = 牌s.map((牌) => 牌ToPai(牌, {no赤牌: true}));

	const agari = new Agari({
		rulevar: {
			dora: {
				akahai: [1, 2, 1],
				kan: {
					daiminkan: 0,
					kakan: 0,
					ankan: 1,
				},
				ura: true,
				kanUra: true,
			},
			yaku: {
				kuitan: true,
				kokushiAnkan: false,
			},
			yakuman: {
				max: 14,
				daisuushi: 2,
				suuankouTanki: 2,
				junseichuurenpoutou: 2,
				tenhou: 1,
				chihou: 2,
				kokushi13: 2,
			},
			riichi: {
				kyoutaku: 1000,
				minTsumoLeft: 4,
				double: true,
				ankan: true,
				okurikan: false,
			},
			ron: {
				atamahane: false,
				honbaAtamahane: true,
				double: true,
				triple: false,
			},
			banKuikae: {
				moro: true,
				suji: true,
				pon: false,
			},
			ryoukyoku: {
				kyuushuukyuuhai: true,
				nagashimangan: false,
				tochuu: {
					suufonrenta: true,
					suukaikan: true,
					suuchariichi: true,
				},
			},
			points: {
				initial: 25000,
				origin: 30000,
				riichi: 1000,
				howanpai: 3000,
				honba: 100,
			},
			setup: {
				points: {
					initial: 25000, origin: 30000,
				},
				end: {
					normal: 2,
					overtime: 3,
					suddenDeath: true,
					oyaALTop: true,
				},
			},
		},

		agariPai: pais[pais.length - 1],
		juntehai: pais.slice(0, -1),
		tenpaiDecomp: decomp.decompTenpai(Pai.binsFromArray(paisWithout赤牌.slice(0, -1))),
		fuuro: [],
		menzen: true,
		riichi: {
			accepted: isRiichi,
			double: isDoubleRiichi,
			ippatsu: isIppatsu,
		},
		doraHyouji: doraHyouji.map((牌) => 牌ToPai(牌)),
		uraDoraHyouji: uraDoraHyouji.map((牌) => 牌ToPai(牌)),
		additionalDora,
		chancha: 0,
		agariPlayer: 0,
		houjuuPlayer: isRon ? 1 : null,
		honba: 0,
		isHaitei,
		virgin: isVirgin,
		bakaze: 0,
		jikaze: 0,
	});

	agari.yaku = agari.yaku || [];
	agari.yakuman = agari.yakuman || [];

	const 役s = (() => {
		if (!agari.isAgari) {
			return null;
		}

		const raw役s = tenhou6.makeAgari({chancha: 0, bakaze: 0}, agari).slice(4);
		const 役sWithoutParens = raw役s.map((string) => string.replace(/\(.+?\)/, ''));
		const 役sWithoutドラ = 役sWithoutParens.filter((役) => !役.includes('ドラ'));
		if (agari.doraTotal > 0) {
			役sWithoutドラ.push(`ドラ${agari.doraTotal}`);
		}

		return 役sWithoutドラ;
	})();

	return {
		agari,
		役s,
	};
};

export const tenpai = (牌s) => {
	const pais = 牌s.map(牌ToPai);
	const tenpaiDecomp = decomp.decompTenpai(Pai.binsFromArray(pais));
	return tenpaiDecomp.decomps.length > 0;
};

export {paiIndices};
