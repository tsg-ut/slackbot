/* eslint-disable import/prefer-default-export */
import {stripIndent} from 'common-tags';
import {z} from 'zod';
import logger from '../lib/logger';
import openai from '../lib/openai';

const log = logger.child({bot: 'tahoiya/arbitraryAibot'});

const MODEL = 'gpt-4.1-mini';
const MAX_ANSWER_LENGTH = 256;

// Initial generation + up to 2 regenerations when the previous attempt is judged correct.
const MAX_GENERATION_ATTEMPTS = 3;

const DecoyAnswerResponse = z.object({
	decoyAnswer: z.string().trim().nonempty(),
});

const JudgeResponse = z.object({
	isCorrect: z.boolean(),
});

const extractJson = (content: string): unknown => {
	const match = content.match(/\{[\s\S]*\}/);
	if (!match) {
		throw new Error(`No JSON object found in response: ${content}`);
	}
	return JSON.parse(match[0]);
};

const buildGenerationPrompt = (
	question: string,
	answer: string,
	previousAttempts: string[],
): string => stripIndent`
	あなたは「たほいや」という言葉遊びゲームの「任意お題モード」に、他のプレイヤーに混じって参加するAIです。
	このモードでは、出題者があらかじめ「質問」と「正解」の組を用意しており、参加者は正解を知らないまま、他のプレイヤーを騙すための「誤答選択肢」を考えて提出します。
	最終的に、正解と全参加者の誤答選択肢がシャッフルされて提示され、他のプレイヤーはどれが正解かを当てます。

	# 質問
	${question}

	# 正解（あなたはこれを知っていますが、誤答選択肢としてこれを使ったり、言い換えて使ったりしてはいけません）
	${answer}

	# あなたのタスク
	以下の手順で思考しながら、この質問に対する「誤答選択肢」を1つ作成してください。

	1. 質問の分野・意図と、正解の形式（固有名詞か説明文か、文体、大まかな分量など）を分析する。
	2. 分析結果を踏まえ、正解と似た形式でありながら内容が異なる、もっともらしい誤答の候補を3つ挙げる。
	3. 各候補について、他のプレイヤーが正解と誤認しそうな説得力があるかを吟味し、最も優れた候補を1つ選ぶ。
	4. 選んだ候補の内容が、正解と実質的に同じ意味になっていないかを再確認し、もし同じ意味であれば候補を修正する。

	# 重要な注意事項（必ず守ること）
	- どのような場合であっても、質問に対して正解となるような回答をしてはいけません。
	- 誤答選択肢は日本語で、正解と同程度の分量・自然さにしてください。
	- 誤答選択肢は${MAX_ANSWER_LENGTH}文字以内にしてください。
	${previousAttempts.length > 0 ? stripIndent`

		# 補足
		以下の誤答選択肢は、実質的に正解と同じ内容であると判定され、却下されました。これらとは異なる、正解ではないことがより明確な誤答選択肢を考えてください。
		${previousAttempts.map((attempt, i) => `${i + 1}. ${attempt}`).join('\n')}
	` : ''}

	最後に、これまでの思考過程を踏まえて、以下のJSON形式のみを出力してください。それ以外の文章は一切出力しないでください。
	\`\`\`
	{"decoyAnswer": "誤答選択肢の文字列"}
	\`\`\`
`;

const buildJudgePrompt = (question: string, answer: string, candidateAnswer: string): string => stripIndent`
	あなたは「たほいや」という言葉遊びゲームにおける、回答の正解判定を行う審判です。
	以下の「質問」と「参考正解」に対して、「判定対象の回答」が正解として扱われるべきかどうかを判定してください。

	# 質問
	${question}

	# 参考正解
	${answer}

	# 判定対象の回答
	${candidateAnswer}

	この任意お題モードでは、質問に対する正解は「参考正解」の一つに限定されるとは限りません。「参考正解」はあくまで
	正解の一例であり、判定対象の回答が「参考正解」と文字列としては異なっていても、あなたの知識に基づいて質問に
	対する事実として正しい別解であると判断できる場合は、正解として扱ってください。
	一方で、判定対象の回答が「参考正解」とも別解とも言えず、質問に対して誤った内容である場合は、誤答として
	扱ってください。

	表記ゆれ・言い回しの違い・言語の違いなどは無視し、意味内容が正解（別解を含む）と実質的に同じであれば true 、
	正解・別解のいずれでもない誤った内容であれば false としてください。

	以下のJSON形式のみを出力してください。それ以外の文章は一切出力しないでください。
	\`\`\`
	{"isCorrect": true または false}
	\`\`\`
`;

const generateDecoyAnswer = async (
	question: string,
	answer: string,
	previousAttempts: string[],
): Promise<string | null> => {
	const response = await openai.chat.completions.create({
		model: MODEL,
		messages: [
			{role: 'user', content: buildGenerationPrompt(question, answer, previousAttempts)},
		],
		max_tokens: 1024,
	});

	const content = response?.choices?.[0]?.message?.content;
	if (!content) {
		log.warn('No content found in the decoy generation response');
		return null;
	}

	const parsed = DecoyAnswerResponse.parse(extractJson(content));
	return parsed.decoyAnswer.slice(0, MAX_ANSWER_LENGTH);
};

const judgeIsCorrect = async (question: string, answer: string, candidateAnswer: string): Promise<boolean> => {
	const response = await openai.chat.completions.create({
		model: MODEL,
		messages: [
			{role: 'user', content: buildJudgePrompt(question, answer, candidateAnswer)},
		],
		max_tokens: 256,
	});

	const content = response?.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('No content found in the judge response');
	}

	const parsed = JudgeResponse.parse(extractJson(content));
	return parsed.isCorrect;
};

// Returns null if generation fails, the API is unavailable, or every attempt ends up
// being judged as a correct answer, so the caller can just skip AI participation.
export const getArbitraryAIAnswer = async (
	question: string,
	answer: string,
): Promise<string | null> => {
	const previousAttempts: string[] = [];

	for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
		let decoyAnswer: string | null = null;

		try {
			decoyAnswer = await generateDecoyAnswer(question, answer, previousAttempts);
		} catch (error) {
			log.error(`Failed to generate decoy answer (attempt ${attempt}): ${(error as Error)?.message ?? error}`);
			return null;
		}

		if (!decoyAnswer) {
			return null;
		}

		try {
			const isCorrect = await judgeIsCorrect(question, answer, decoyAnswer);
			if (!isCorrect) {
				return decoyAnswer;
			}
			log.warn(`Decoy answer "${decoyAnswer}" was judged as correct (attempt ${attempt}/${MAX_GENERATION_ATTEMPTS})`);
		} catch (error) {
			log.error(`Failed to judge decoy answer (attempt ${attempt}): ${(error as Error)?.message ?? error}`);
			return null;
		}

		previousAttempts.push(decoyAnswer);
	}

	log.warn(`Gave up generating a decoy answer for question "${question}" after ${MAX_GENERATION_ATTEMPTS} attempts`);
	return null;
};
