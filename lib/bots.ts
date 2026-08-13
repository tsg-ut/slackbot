import fs from 'fs';
import path from 'path';

export const productionBots = [
	'summary',
	'mahjong',
	'pocky',
	'emoji-notifier',
	'sushi-bot',
	'shogi',
	'tiobot',
	'checkin',
	'tahoiya',
	'channel-notifier',
	'prime',
	'dajare',
	'sunrise',
	'ahokusa',
	// ...(word2vecInstalled ? ['vocabwar'] : []),
	'ricochet-robots',
	'scrapbox',
	'slack-log',
	'welcome',
	'deploy',
	'achievements',
	'mail-hook',
	'wordhero',
	'wordhero/crossword',
	'oauth',
	'tunnel',
	'voiperrobot',
	'atcoder',
	'lyrics',
	'better-custom-response',
	'emoxpand',
	'ponpe',
	'anime',
	'anime/anison',
	'oogiri',
	'sorting-riddles',
	'tsglive',
	'emoji-modifier',
	'context-free',
	'room-gacha',
	'taiko',
	'hayaoshi',
	'twitter-dm-notifier',
	'hitandblow',
	'discord',
	'octas',
	'pwnyaa',
	'amongyou',
	'api',
	'hangman',
	'hakatashi-visor',
	'nojoin',
	'remember-english',
	'golfbot',
	'kirafan/quiz',
	'topic',
	'bungo-quiz',
	'adventar',
	'jantama',
	'tabi-gatcha',
	'achievement-quiz',
	'wadokaichin',
	'wordle-battle',
	// 'slow-quiz',
	'dicebot',
	'taimai',
	'map-guessr',
	'character-quiz',
	'shmug',
	'pilot',
	'qrcode-quiz',
	'oneiromancy',
	'auto-archiver',
	'city-symbol',
	'nmpz',
	'autogen-quiz',
	'twenty-questions',
	'google-calendar',
];

export const developmentBots = [
	'helloworld',
];

export const allBots = [...productionBots, ...developmentBots];

// Node の native ESM では拡張子なし・ディレクトリインデックス省略の import が
// 解決できないため、動的 import 前にプラグインの実体ファイルパスを解決する。
// プラグインは「name.ts」(単一ファイル) と「name/index.ts」(ディレクトリ) の
// 2パターンがあるため、実ファイルの有無で判定する。
export const resolveBotEntryPath = (baseDir: string, name: string, prefix = './'): string => {
	const directPath = path.join(baseDir, `${name}.ts`);
	const directJsPath = path.join(baseDir, `${name}.js`);
	if (fs.existsSync(directPath) || fs.existsSync(directJsPath)) {
		return `${prefix}${name}.js`;
	}
	return `${prefix}${name}/index.js`;
};
