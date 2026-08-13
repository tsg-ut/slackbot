/* eslint-disable import/prefer-default-export */
import {inspect} from 'util';
import {stripIndent} from 'common-tags';
import {z} from 'zod';
import logger from '../lib/logger.js';
import openai from '../lib/openai.js';

const log = logger.child({bot: 'tahoiya/arbitraryAibot'});

const MODEL = 'gpt-5.4-mini';
const MAX_ANSWER_LENGTH = 256;
const CANDIDATE_COUNT = 5;

const MAX_GENERATION_ATTEMPTS = 1;

// Worst-case cost per daily tahoiya (question/answer at Slack's 3000-char input cap, all
// candidates but the last judged as correct so all judge calls run): 1 generation call
// (~3.7k input / up to 4096 output tokens) + up to 5 judge calls (~6.9k input / 128 output
// tokens each) ≈ 38k input + 4.7k output tokens. At gpt-5.4-mini pricing ($0.75 / $4.50 per
// 1M tokens) that's about $0.05 per daily tahoiya.

const DecoyAnswerResponse = z.object({
	candidateAnswers: z.array(z.string().trim().nonempty()).min(1),
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
	previousAttempts: string[],
): string => stripIndent`
	あなたは「たほいや」という言葉遊びゲームの「任意お題モード」に、他のプレイヤーに混じって参加するAIです。
	このモードでは、出題者があらかじめ「質問」と「正解」の組を用意しており、参加者は正解を知らないまま、他のプレイヤーを騙すための「誤答選択肢」を考えて提出します。
	最終的に、正解と全参加者の誤答選択肢がシャッフルされて提示され、他のプレイヤーはどれが正解かを当てます。

	以下の質問に対して、もっともらしい回答の候補を${CANDIDATE_COUNT}個考えてください。
	後ほど、あなたの知らない実際の正解と照らし合わせて判定が行われ、正解ではないと判定された候補の中から1つが、あなたの誤答選択肢として採用されます。

	# 質問
	${question}

	# あなたのタスク
	以下の手順で思考しながら、この質問に対する回答の候補を${CANDIDATE_COUNT}個作成してください。

	1. 質問の分野・意図を分析し、想定される回答の形式（固有名詞か説明文か、文体、大まかな分量など）を推測する。
	2. 分析結果を踏まえ、もっともらしい回答の候補を、互いに異なる方向性（別の固有名詞、別の解釈など）で自由な発想で${CANDIDATE_COUNT}個挙げる。
	3. 各候補について、あなた自身の知識に照らして質問に対する正しい回答になっていないかを確認し、正しい回答になっていると思われる候補があれば別の候補に差し替える。
	4. 各候補が、質問に対する回答として他のプレイヤーに正解と誤認されうるだけの自然さ・説得力があるかを吟味する。

	# 重要な注意事項（必ず守ること）
	- どのような場合であっても、あなた自身が質問に対して正しいと考える内容を候補に含めてはいけません。あなたの知識から見て事実として正しいと考えられる回答は、実際の正解と一致する（＝却下される）可能性が高いため、必ず避けてください。
	- ${CANDIDATE_COUNT}個の候補は、それぞれ内容が重複しないようにしてください。
	- 候補は日本語で、質問に対して自然な分量・文体にしてください。
	- 各候補は${MAX_ANSWER_LENGTH}文字以内にしてください。
	${previousAttempts.length > 0 ? stripIndent`

		# 補足
		以下の候補は、いずれも実際の正解と一致すると判定され、却下されました。これらとは異なる候補を考えてください。
		${previousAttempts.map((attempt, i) => `${i + 1}. ${attempt}`).join('\n')}
	` : ''}

	最後に、これまでの思考過程を踏まえて、以下のJSON形式のみを出力してください。それ以外の文章は一切出力しないでください。
	\`\`\`
	{"candidateAnswers": ["候補1", "候補2", "候補3", "候補4", "候補5"]}
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
	正解の一例であり、判定対象の回答が「参考正解」と文字列としては異なっていても、あなたの知識に基づいて質問に対する事実として正しい別解であると判断できる場合は、正解として扱ってください。
	一方で、判定対象の回答が「参考正解」とも別解とも言えず、質問に対して誤った内容である場合は、誤答として扱ってください。

	表記ゆれ・言い回しの違い・言語の違いなどは無視し、意味内容が正解（別解を含む）と実質的に同じであれば true 、
	正解・別解のいずれでもない誤った内容であれば false としてください。

	以下のJSON形式のみを出力してください。それ以外の文章は一切出力しないでください。
	\`\`\`
	{"isCorrect": true または false}
	\`\`\`
`;

const generateDecoyAnswerCandidates = async (
	question: string,
	previousAttempts: string[],
): Promise<string[] | null> => {
	const response = await openai.chat.completions.create({
		model: MODEL,
		messages: [
			{role: 'user', content: buildGenerationPrompt(question, previousAttempts)},
		],
		max_completion_tokens: 4096,
		reasoning_effort: 'medium',
	});

	log.debug(inspect(response, {depth: null}));

	const content = response?.choices?.[0]?.message?.content;
	if (!content) {
		log.warn('No content found in the decoy generation response');
		return null;
	}

	const parsed = DecoyAnswerResponse.parse(extractJson(content));
	return parsed.candidateAnswers
		.slice(0, CANDIDATE_COUNT)
		.map((candidate) => candidate.slice(0, MAX_ANSWER_LENGTH));
};

const judgeIsCorrect = async (question: string, answer: string, candidateAnswer: string): Promise<boolean> => {
	const response = await openai.chat.completions.create({
		model: MODEL,
		messages: [
			{role: 'user', content: buildJudgePrompt(question, answer, candidateAnswer)},
		],
		max_completion_tokens: 128,
		reasoning_effort: 'none',
	});

	const content = response?.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('No content found in the judge response');
	}

	const parsed = JudgeResponse.parse(extractJson(content));
	return parsed.isCorrect;
};

// Returns null if generation fails, the API is unavailable, or every candidate across every attempt
// ends up being judged as a correct answer, so the caller can just skip AI participation.
export const getArbitraryAIAnswer = async (
	question: string,
	answer: string,
): Promise<string | null> => {
	const previousAttempts: string[] = [];

	for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
		let candidates: string[] | null = null;

		try {
			candidates = await generateDecoyAnswerCandidates(question, previousAttempts);
		} catch (error) {
			log.error(`Failed to generate decoy answer candidates (attempt ${attempt}): ${(error as Error)?.message ?? error}`);
			return null;
		}

		if (!candidates || candidates.length === 0) {
			return null;
		}

		for (const candidate of candidates) {
			try {
				const isCorrect = await judgeIsCorrect(question, answer, candidate);
				if (!isCorrect) {
					return candidate;
				}
				log.warn(`Candidate answer "${candidate}" was judged as correct (attempt ${attempt}/${MAX_GENERATION_ATTEMPTS})`);
			} catch (error) {
				log.error(`Failed to judge candidate answer (attempt ${attempt}): ${(error as Error)?.message ?? error}`);
				return null;
			}
		}

		previousAttempts.push(...candidates);
	}

	log.warn(`Gave up generating a decoy answer for question "${question}" after ${MAX_GENERATION_ATTEMPTS} attempts`);
	return null;
};
