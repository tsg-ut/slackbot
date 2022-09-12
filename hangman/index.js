
const { random, range } = require('lodash');
const { promises: fs, constants } = require('fs');
const path = require('path');
const download = require('download');
const { stripIndents } = require("common-tags");
const { unlock, increment, set } = require('../achievements');
const { default: logger } = require('../lib/logger.ts');
const { getMemberName } = require('../lib/slackUtils');
const axios = require('axios');

const BOT_NAME = "hangmanbot";
const BOT_CALL_KEYWORD = "hangman";

const state = (() => {
    try {
        return require('./state.json');
    } catch (e) {
        return {};
    }
})();

const setState = async (newState) => {
    Object.assign(state, newState);

    const savedState = {};
    for (const [key, value] of Object.entries(state)) {
        savedState[key] = value;
    }

    await fs.writeFile(
        path.join(__dirname, 'state.json'),
        JSON.stringify(savedState),
    );
};

//open a character
const openCharacter = async (character, slackid) => {
    const challenger = getChallengerById(slackid);
    if (challenger === null) {
        logger.error(`Not found the challenger of ID: ${slackid}`);
        return 'invalid';
    }
    if (challenger.usedCharacterList.includes(character)) {
        return 'invalid';
    }
    const newOpenList = challenger.openList.slice();
    let letterCount = 0;
    for (const index of range(challenger.answer.length)) {
        if (challenger.answer[index] === character) {
            newOpenList[index] = true;
            letterCount += 1;
        }
    }

    const succeeded = (letterCount > 0);

    if (succeeded) {
        await increment(slackid, 'hangman-letters', letterCount);
    }

    await setState({
        ...state,
        [slackid]: {
            ...challenger,
            openList: newOpenList,
            usedCharacterList: challenger.usedCharacterList.concat([character]),
            triesLeft: challenger.triesLeft - (succeeded ? 0 : 1),
        }
    });
    
    return succeeded ? 'success' : 'failure';
};

//guess the whole string
const guessAnswer = async (candidate, challenger) => {
    const succeeded = (challenger.answer === candidate);
    const slackid = getChallengerByTs(challenger.thread).slackid;
    if (succeeded) {
        const countUnique = (iterable) => {
            return new Set(iterable).size;
        }
        const closedChars = challenger.answer.split('').filter((character, index) => !challenger.openList[index]);
        if (countUnique(closedChars) >= 3) {
            await unlock(slackid, 'hangman-multiple-letters');
        }
        return 'success';
    } 
    else {
        setState({
            ...state,
            [slackid]: {
                ...challenger,
                triesLeft: challenger.triesLeft - 1,
            },
        });
        return 'failure';
    }
};

const getOpenListString = (slackid) => {
    const challenger = getChallengerById(slackid);
    return '`' + challenger.openList.map((flag, index) => (flag ? challenger.answer[index] : '_')).join(' ') + '`';
};

const getUsedString = (slackid) => {
    const challenger = getChallengerById(slackid);
    return challenger.usedCharacterList.map(character => '`' + character + '`').join(' ') ;
};

const tmpDictionary = [
    'apple', 'banana', 'carrot', 'xylophone', 'algae'
];

async function getDictionary() {
    const dictionaryPath = path.resolve(__dirname, 'wordset.txt');
    const exists = await fs.access(dictionaryPath, constants.R_OK).then(() => true).catch(() => false);
    const downloadLink = "https://gist.githubusercontent.com/platypus999/1f96b0658f900ffa5d34ce468ede5b9a/raw/5825dd2aa6d8863ef576c348bc249061c07a1a74/hangman_set.txt";
    if (!exists) {
        await download(downloadLink, __dirname, {filename: 'wordset.txt'});
    }
    const dictionary = await fs.readFile(dictionaryPath);
    const entries = dictionary.toString().split('\n').filter((line) => (
        !line.startsWith('#') && line.length !== 0));
    return entries;
}

const numberOfTries = 6;

// get a random word from dictionary
const getRandomWord = (diffValue, wordList) => {
    let freqLeft = 0;
    let freqRight = 100;
    let minLength = 5;
    switch (diffValue) {
        case 'easy':
            freqLeft = 0;
            freqRight = 1000;
            minLength = 8;
            break;
        case 'medium':
            freqLeft = 1000;
            freqRight = 4000;
            minLength = 7;
            break;
        case 'hard':
            freqLeft = 4000;
            freqRight = 5500;
            minLength = 6;
            break;
        case 'extreme':
            freqLeft = 7000;
            freqRight = 10000;
            minLength = 5;
            break;
    }
    if (!wordList) wordList = tmpDictionary;
    for (var i = 0; i < 10; i++) {
        const randomIndex = random(freqLeft, freqRight - 1, false);
        const result = wordList[randomIndex % wordList.length];
        logger.info(`Word found: ${result}`);
        if (result.length >= minLength && result.match(/^[a-z]+$/)) {
            return result;
        }
    } 
    return 'hangman';
};

// get the word definition from dictionaryapi.dev
const getDefinitionsFromWord = async (word) => {
    const apiLink = `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`;
    logger.info("Getting from " + apiLink);
    try {
        const response = await axios.get(apiLink);
        if (!response.data[0]) {
            return undefined;
        }
        const data = response.data;
        logger.info(data);
        return data;
    }
    catch (error) {
        logger.info(error);
        return undefined;
    }
};

const parseDefinitions = (definitions) => {
    return definitions.map((definition) => 
        `*${definition["word"]}* ${definition["phonetic"] || ""}\n`.concat(
            definition["meanings"].map((meaning) => 
                `(${meaning["partOfSpeech"]})\n`.concat(
                    meaning["definitions"].map((def, index) => 
                        `${index+1}. ${def["definition"]}`
                    ).join('\n')
                )
            ).join('\n')
        ).concat(`\n<${definition["sourceUrls"]}|source>`)
    ).join('\n');
};

const resetConsecutiveAchievements = async (slackid) => {
    await set(slackid, 'hangman-consecutive', 0);
    if (state[slackid].openList.every(x => !x)) {
        await unlock(slackid, 'hangman-reverse-perfect');
    }
};

const unlockGameAchievements = async (slackid) => {
    await increment(slackid, 'hangman-clear');
    if (state[slackid].diffValue === 'hard' || state[slackid].diffValue === 'extreme') {
        await increment(slackid, 'hangman-consecutive');
    }
    if (state[slackid].triesLeft === numberOfTries) {
        await unlock(slackid, 'hangman-perfect');
    }
    if (state[slackid].answer.length <= 6) {
        await unlock(slackid, 'hangman-short');
    }
    if (state[slackid].answer.match(/[xzjq]/)) {
        await unlock(slackid, 'hangman-xzjq');
    }
    if (state[slackid].diffValue === 'extreme') {
        await unlock(slackid, 'hangman-extreme-clear');
    }
};

const getChallengerByTs = (ts) => {
    for (const slackid in state) {
        if (state[slackid].thread === ts)
            return { slackid, challenger: state[slackid]};
    }
    return null;
}

const getChallengerById = (slackid) => {
    if (slackid in state) {
        return state[slackid];
    }
    return null;
};

module.exports = ({ eventClient, webClient: slack }) => {
    const postMessage = (text, slackid, options) => slack.chat.postMessage({
        channel: process.env.CHANNEL_SANDBOX,
        text,
        username: BOT_NAME,
        // eslint-disable-next-line camelcase
        icon_emoji: ':capital_abcd:',
        ...(options ? options : {}),
        ...(slackid !== undefined && state[slackid] !== undefined && state[slackid].thread ? { thread_ts: state[slackid].thread } : {}),
    });

    const postGameStatus = async (header, slackid) => {
        return await postMessage(stripIndents`${header}
                現在の状態: ${getOpenListString(slackid)}
                使った文字: ${getUsedString(slackid)}
                残機: ${state[slackid].triesLeft}`, slackid);
    };

    const postGameResult = async (header, slackid) => {
        const challenger = getChallengerById(slackid);
        await postMessage(
            stripIndents`
                ${header}
                答えは \`${challenger.answer}\` でした
                ${challenger.triesLeft === numberOfTries && state[slackid].openList.every(x => x) ? ':ojigineko-superfast: パーフェクト解答！すごいね！ :ojigineko-drug:' : ''}`,
            slackid, {
                reply_broadcast: true
        });
        if (challenger.definitionText) {
            return postMessage(
                stripIndents`${challenger.definitionText}`, slackid);
        }
    };

    const postDefinitionText = async (slackid) => {
        if (challenger.definitionText) {
            return await postMessage(
                stripIndents`${challenger.definitionText}`, slackid);
        }
    };

    eventClient.on('message', async (message) => {
        if (message.channel !== process.env.CHANNEL_SANDBOX || !!message.subtype || !message.text || message.username === BOT_NAME || !message.user) {
            return;
        }

        const { text, user } = message;
        
        let matches = null;

        // reset command is available both within threads or not
        if (text === `${BOT_CALL_KEYWORD} reset`) {
            logger.info("resetting Sadge");
            const challenger = getChallengerById(user);
            if (challenger === null) {
                await postMessage(`*${await getMemberName(user)}* はプレイ中じゃないよ!`);
            } else {
                delete state[user];
                setState(state, state);
                await postMessage(`*${await getMemberName(user)}* のゲームをリセットしたよ!`);
            }
            return;
        }
        if (!message.thread_ts && (matches = text.match(new RegExp(`^${BOT_CALL_KEYWORD}(|\\s\\w*)$`, "i")))) {
            // check if the challenger is now playing game
            if (getChallengerById(message.user) !== null) {
                return await postMessage(`*${await getMemberName(message.user)}* は Hangman をプレイ中だよ!!`);
            } else {
                challenger = {
                    phase: 'waiting',
                    thread: null,
                    diffValue: '',
                    answer: '',
                    openList: [],
                    usedCharacterList: [],
                    triesLeft: 0,
                };
                setState({
                    ...state,
                    [message.user]: {
                        phase: 'waiting',
                        thread: null,
                        diffValue: '',
                        answer: '',
                        openList: [],
                        usedCharacterList: [],
                        triesLeft: 0,
                }});
            }

            //string matches "hangman" or "hangman <difficulty>"
            const difficultyString = ((matches[1] === "") ? "medium" : matches[1].slice(1));
            if (!difficultyString.match(/easy|medium|hard|extreme/)) {
                await postMessage('難易度はeasy/medium/hard/extremeのどれかを指定してね');
                delete state[message.user];
                setState(state, state);

                return;
            }

            const wordList = await getDictionary();

            const word = getRandomWord(difficultyString, wordList);
            
            const definition = await getDefinitionsFromWord(word);
            
            const definitionText = (!!definition) ? parseDefinitions(definition) : "";

            const wordLength = word.length;
            await setState({
                ...state,
                [message.user]: {
                    ...state[message.user],
                    phase: 'playing',
                    diffValue: difficultyString,
                    answer: word,
                    definitionText: definitionText,
                    openList: Array(wordLength).fill(false),
                    triesLeft: numberOfTries,
                }
            });

            const { ts } = await postGameStatus('Hangmanを始めるよ！正解の英単語を当てよう！', message.user);

            await setState({
                ...state,
                [message.user]: {
                    ...state[message.user],
                    thread: ts,
                }
            });

            await postMessage(stripIndents`答え方
            小文字アルファベットを書く: \`x\`
            単語を丸ごと宣言する: \`!word\``, message.user);

            const currentThread = state[message.user].thread;
            setTimeout(async () => {
                if (currentThread === state[message.user].thread) {
                    await postGameResult(':clock3: タイムオーバー :sweat:', message.user);
                    await resetConsecutiveAchievements(message.user);
                    delete state[message.user];
                    setState(state, state);
                }
            }, 4 * 60 * 1000);
            
            return;
        } // ( end hangman .+ command )

        if (!!message.thread_ts) { // available only within the thread
            const challenger_result = getChallengerByTs(message.thread_ts);
            if (challenger_result === null) {
                return;
            }
            const { slackid, challenger } = challenger_result;
            if (text.match(/^[a-z]$/)) {
                if (state[slackid].phase !== 'playing') {
                    return;
                }
                if (slackid !== user) {
                    return;
                }
                const response = await openCharacter(text, slackid);
                if (response === 'success') {
                    if (!state[slackid].openList.every(x => x)) {
                        postGameStatus(':ok:', slackid);
                        return;
                    }
                    else {
                        await postGameResult(':tada: 正解！ :partying_face:', slackid);
                        await unlockGameAchievements(slackid);
                        delete state[slackid];
                        setState(state, state);
                        return;
                    }
                } 
                else if (response === 'failure') {
                    if (state[slackid].triesLeft > 0) {
                        await postGameStatus(':ng: 間違っています :ng:', slackid);
                        return;
                    }
                    else {
                        await postGameResult(':cry: ゲームオーバー :pensive:', slackid);
                        await resetConsecutiveAchievements(slackid);
                        delete state[slackid];
                        setState(state, state);
                        return;
                    }
                }
                else {
                    postGameStatus(':thinking_face: その手はよくわからないよ :thinking_face:', slackid);
                    return;
                }
            }
            if (matches = text.match(/^!([a-z]+)/)) {
                const {slackid, _challenger} = getChallengerByTs(message.thread_ts);
                if (_challenger === null) {
                    logger.error(`Not found the user with ts(${message.thread_ts})`);
                    return;
                }

                if (state[slackid].phase !== 'playing') {
                    return;
                }
                if (slackid !== user) {
                    return;
                }
                const response = await guessAnswer(matches[1], state[slackid]);
                if (response === 'success') {
                    await postGameResult(':tada: 正解！ :astonished:', slackid);
                    await unlockGameAchievements(slackid);
                    delete state[slackid];
                    setState(state, state);
                    return;
                }
                else if (response === 'failure') {
                    if (state[slackid].triesLeft > 0) {
                        postGameStatus(':ng: 失敗です…… :ng:', slackid);
                        return;
                    }
                    else {
                        await postGameResult(':cry: ゲームオーバー :pensive:', slackid);
                        await resetConsecutiveAchievements(slackid);
                        delete state[slackid];
                        setState(state, state);
                        return;
                    }
                } 
                else {
                    postGameStatus(':thinking_face: その手はよくわからないよ :thinking_face:', slackid);
                    return;
                }
            }
        }
    });
};
