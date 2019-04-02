interface Achievement {
	id: string,
	difficulty: 'baby' | 'easy' | 'medium' | 'hard' | 'professional',
	title: string,
	condition: string,
	counter?: string,
	value?: number,
	manual?: true,
}

const achievements: Achievement[] = [
	{
		id: 'chat',
		difficulty: 'baby',
		title: 'はじめまして!',
		condition: 'パブリックなチャンネルで初めて発言する',
		counter: 'chats',
		value: 1,
	},
	{
		id: 'chat-10times',
		difficulty: 'easy',
		title: 'ｽｯｺｺｺ',
		condition: 'パブリックなチャンネルで10回以上発言する',
		counter: 'chats',
		value: 10,
	},
	{
		id: 'chat-1000times',
		difficulty: 'hard',
		title: '話のタネ',
		condition: 'パブリックなチャンネルで1000回以上発言する',
		counter: 'chats',
		value: 1000,
	},
	{
		id: 'chat-10days',
		difficulty: 'medium',
		title: '常連',
		condition: 'パブリックなチャンネルでのべ10日間発言する',
		counter: 'chatDays',
		value: 10,
	},
	{
		id: 'chat-100days',
		difficulty: 'hard',
		title: 'いつものメンバー',
		condition: 'パブリックなチャンネルでのべ100日間発言する',
		counter: 'chatDays',
		value: 100,
	},
	{
		id: 'chat-1000days',
		difficulty: 'professional',
		title: 'TSGの主',
		condition: 'パブリックなチャンネルでのべ1000日間発言する',
		counter: 'chatDays',
		value: 1000,
	},

	// sushi-bot

	{
		id: 'get-sushi',
		difficulty: 'baby',
		title: '玉子',
		condition: 'sushi-botから寿司をもらう',
	},
	{
		id: 'get-multiple-sushi',
		difficulty: 'easy',
		title: 'マグロ',
		condition: 'sushi-botから一度に2個以上の寿司をもらう',
	},
	{
		id: 'get-infinite-sushi',
		difficulty: 'easy',
		title: 'ハマチ',
		condition: 'sushi-botから一度に無限個の寿司をもらう',
	},
	{
		id: 'wednesday-sushi',
		difficulty: 'medium',
		title: 'すしすしすいようび',
		condition: '水曜日にsushi-botから寿司をもらう',
	},
	{
		id: 'freezing',
		difficulty: 'easy',
		title: 'フリージング',
		condition: 'sushi-botに凍結される',
	},
	{
		id: 'freezing-master',
		difficulty: 'hard',
		title: '氷属性',
		condition: '週間凍結ランキングで1位を獲得する',
	},

	// tashibot

	{
		id: 'place',
		difficulty: 'easy',
		title: '旅人',
		condition: 'tashibotに反応される',
	},
	{
		id: 'new-place',
		difficulty: 'medium',
		title: '開拓者',
		condition: 'tashibotで新しい地名を獲得する',
	},

	// dajare

	{
		id: 'zabuton',
		difficulty: 'easy',
		title: 'だじゃれを言うのは誰じゃ',
		condition: 'dajareボットから:zabuton:をもらう',
	},
	{
		id: 'zabutons',
		difficulty: 'easy',
		title: 'タワーの上に登ったわ―',
		condition: 'dajareボットから:zabutons:をもらう',
	},
	{
		id: 'flying-zabuton',
		difficulty: 'easy',
		title: '座布団がぶっ飛んだ',
		condition: 'dajareボットから:flying-zabuton:をもらう',
	},

	// pocky

	{
		id: 'pocky',
		difficulty: 'baby',
		title: 'はま寿司',
		condition: 'pockyに反応される',
	},
	{
		id: 'long-pocky',
		difficulty: 'medium',
		title: 'スーモ',
		condition: 'pockyから20文字以上の返答を得る',
	},

	// tahoiya

	{
		id: 'tahoiya',
		difficulty: 'easy',
		title: '千里の道も一歩から',
		condition: 'たほいやに参加する',
	},
	{
		id: 'daily-tahoiya-theme',
		difficulty: 'medium',
		title: '大智は愚の如し',
		condition: 'デイリーたほいやにお題を登録する',
	},
	{
		id: 'tahoiya-over6',
		difficulty: 'medium',
		title: '坊主丸儲け',
		condition: 'たほいやで一度にプラス6点以上獲得する',
	},
	{
		id: 'tahoiya-over10',
		difficulty: 'hard',
		title: '一攫千金',
		condition: 'たほいやで一度にプラス10点以上獲得する',
	},
	{
		id: 'tahoiya-down10',
		difficulty: 'medium',
		title: '悪銭身につかず',
		condition: 'たほいやで前回より10点以上低い点数を獲得する',
	},
	{
		id: 'tahoiya-deceive',
		difficulty: 'medium',
		title: '笑中に刀あり',
		condition: 'たほいやで他の人をひっかける',
	},
	{
		id: 'tahoiya-deceive3',
		difficulty: 'hard',
		title: '麦飯で鯉を釣る',
		condition: 'たほいやで1度に3人以上をひっかける',
	},
	{
		id: 'tahoiya-5bet',
		difficulty: 'medium',
		title: '乾坤一擲',
		condition: 'たほいやで5枚BETする',
	},

	{
		id: 'tahoiya-turing',
		difficulty: 'medium',
		title: 'シンギュラリティ',
		condition: 'たほいやでAIに振り込んでしまう',
	},

	// mahjong

	{
		id: 'mahjong',
		difficulty: 'easy',
		title: 'みっつずつ、みっつずつ⋯⋯',
		condition: '麻雀BOTで和了する',
	},
	{
		id: 'mahjong-七対子',
		difficulty: 'medium',
		title: 'ふたつずつ、ふたつずつ⋯⋯',
		condition: '麻雀BOTで七対子を和了する',
	},
	{
		id: 'mahjong-12000',
		difficulty: 'easy',
		title: 'ザンクを三回刻むより',
		condition: '麻雀BOTで満貫以上を和了する',
	},
	{
		id: 'mahjong-24000',
		difficulty: 'medium',
		title: '来たぜぬるりと⋯⋯',
		condition: '麻雀BOTで倍満以上を和了する',
	},
	{
		id: 'mahjong-36000',
		difficulty: 'hard',
		title: '御無礼',
		condition: '麻雀BOTで三倍満以上を和了する',
	},
	{
		id: 'mahjong-48000',
		difficulty: 'professional',
		title: '麻雀って楽しいね！',
		condition: '麻雀BOTで役満を和了する',
	},
	{
		id: 'mahjong-ikeda',
		difficulty: 'medium',
		title: '池田ァ！',
		condition: '麻雀BOTで七筒を切る',
	},
	{
		id: 'mahjong-不聴立直',
		difficulty: 'medium',
		title: '後の三巡',
		condition: '麻雀BOTで不聴立直をする',
	},

	// shogi

	{
		id: 'shogi',
		difficulty: 'easy',
		title: '勝ち将棋鬼の如し',
		condition: '将棋BOTで勝利する',
	},
	{
		id: 'shogi-shortest',
		difficulty: 'medium',
		title: '長い詰みより短い必至',
		condition: '将棋BOTで最短勝利する',
	},
	{
		id: 'shogi-over11',
		difficulty: 'hard',
		title: '勝ち将棋を勝て',
		condition: '将棋BOTで11手必勝以上の盤面で最短勝利する',
	},
	{
		id: 'shogi-over19',
		difficulty: 'professional',
		title: '名人に定跡なし',
		condition: '将棋BOTで19手必勝以上の盤面で最短勝利する',
	},
	{
		id: 'shogi-銀不成',
		difficulty: 'hard',
		title: '銀は不成に好手あり',
		condition: '将棋BOTで銀不成を含む手順で最短勝利する',
	},
	{
		id: 'shogi-自陣飛車',
		difficulty: 'hard',
		title: '自陣飛車に好手あり',
		condition: '将棋BOTで自陣への飛車打を含む手順で最短勝利する',
	},
	{
		id: 'shogi-自陣角',
		difficulty: 'hard',
		title: '遠見の角に好手あり',
		condition: '将棋BOTで自陣への角打を含む手順で最短勝利する',
	},
	{
		id: 'shogi-歩成',
		difficulty: 'medium',
		title: 'マムシのと金',
		condition: '将棋BOTで歩成を含む手順で最短勝利する',
	},
	{
		id: 'shogi-三桂',
		difficulty: 'hard',
		title: '三桂あって詰まぬことなし',
		condition: '将棋BOTで桂馬を3つ以上所持した初期盤面で最短勝利する',
	},
	{
		id: 'shogi-打ち歩詰め',
		difficulty: 'hard',
		title: '打ち歩詰めに詰みの余地あり',
		condition: '将棋BOTで打ち歩詰めで敗北する',
	},

	// prime

	{
		id: 'prime',
		difficulty: 'baby',
		title: 'ピタゴラス',
		condition: '素数大富豪で遊ぶ',
	},
	{
		id: 'prime-clear',
		difficulty: 'medium',
		title: 'ディオファントス',
		condition: '素数大富豪をクリアする',
	},
	{
		id: 'prime-fast-clear',
		difficulty: 'hard',
		title: 'レオンハルト・オイラー',
		condition: '素数大富豪を4ターン以内でクリアする',
	},
	{
		id: 'prime-fast-clear-wo-draw',
		difficulty: 'hard',
		title: 'カール・フリードリヒ・ガウス',
		condition: '素数大富豪をドローせずに4ターン以内でクリアする',
	},
	{
		id: 'prime-composition-8',
		difficulty: 'hard',
		title: 'ジョゼフ＝ルイ・ラグランジュ',
		condition: '素数大富豪で合成数出しによって8枚以上を同時に捨てる',
	},
	{
		id: 'prime-grothendieck',
		difficulty: 'medium',
		title: 'アレクサンドル・グロタンディーク',
		condition: '素数大富豪でグロタンカットを発生させる',
	},
	{
		id: 'prime-ramanujan',
		difficulty: 'hard',
		title: 'シュリニヴァーサ・ラマヌジャン',
		condition: '素数大富豪でラマヌジャン革命を発生させる',
	},
	{
		id: 'prime-mersenne',
		difficulty: 'medium',
		title: 'マラン・メルセンヌ',
		condition: '素数大富豪で3桁以上のメルセンヌ素数を捨てる',
	},
	{
		id: 'prime-fermat',
		difficulty: 'medium',
		title: 'ピエール・ド・フェルマー',
		condition: '素数大富豪で3桁以上のフェルマー素数を捨てる',
	},
	{
		id: 'prime-fibonacci',
		difficulty: 'medium',
		title: 'レオナルド・フィボナッチ',
		condition: '素数大富豪で3桁以上のフィボナッチ素数を捨てる',
	},
	{
		id: 'prime-lucas',
		difficulty: 'medium',
		title: 'エドゥアール・リュカ',
		condition: '素数大富豪で3桁以上のリュカ素数を捨てる',
	},

	// achievements

	{
		id: 'achievements',
		difficulty: 'easy',
		title: '実績解除',
		condition: '初めて実績解除する',
	},
	{
		id: 'achievements-3',
		difficulty: 'easy',
		title: '解解解除',
		condition: '難易度easy以上の実績を3つ解除する',
	},
	{
		id: 'achievements-10',
		difficulty: 'medium',
		title: '解解解解解解解解解解除',
		condition: '難易度easy以上の実績を10個解除する',
	},
	{
		id: 'achievements-master',
		difficulty: 'medium',
		title: '実績マスター',
		condition: '難易度medium以上の実績を10個解除する',
	},

	// manual

	{
		id: 'sig',
		difficulty: 'medium',
		title: 'TSG初心者',
		condition: '分科会に参加する',
		manual: true,
	},
	{
		id: 'sig-3times',
		difficulty: 'hard',
		title: 'TSG中級者',
		condition: '分科会に3回以上参加する',
		manual: true,
	},
	{
		id: 'sig-5times',
		difficulty: 'hard',
		title: 'TSG上級者',
		condition: '分科会に5回以上参加する',
		manual: true,
	},
	{
		id: 'clubroom',
		difficulty: 'medium',
		title: '足跡',
		condition: 'TSGの部室を訪問する',
		manual: true,
	},
	{
		id: 'heiankyo-alien',
		difficulty: 'hard',
		title: '歴史との邂逅',
		condition: 'TSGの部室で平安京エイリアンをプレイする',
		manual: true,
	},
	{
		id: 'scrapbox',
		difficulty: 'medium',
		title: '切り抜き箱',
		condition: 'scrapboxに自分の名前の記事を作成する',
		manual: true,
	},
	{
		id: 'github',
		difficulty: 'hard',
		title: 'コントリビューター',
		condition: 'GitHubのtsg-ut下のリポジトリにコミットする',
		manual: true,
	},
	{
		id: 'github-slackbot',
		difficulty: 'hard',
		title: 'BOT駆動開発',
		condition: 'GitHubのtsg-ut/slackbotにコミットする',
		manual: true,
	},
];

export default achievements;