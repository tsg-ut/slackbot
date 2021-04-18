
const { random, range } = require('lodash');
const { promises: fs, constants } = require('fs');
const { promisify } = require('util');
const path = require('path');
const download = require('download');
const { stripIndents } = require("common-tags");
const { unlock, increment, set } = require('../achievements');
const { default: logger } = require('../lib/logger.ts');

const state = (() => {
    try {
        const savedState = require('./state.json');
        return {
            phase: savedState.phase,
            challenger: savedState.challenger || null,
            thread: savedState.thread || null,
            diffValue: savedState.diffValue || '',
            answer: savedState.answer || '',
            openList: savedState.openList || [],
            usedCharacterList: savedState.usedCharacterList || [],
            triesLeft: savedState.triesLeft || 0,
        };
    } catch (e) {
        return {
            phase: 'waiting',
            challenger: null,
            thread: null,
            diffValue: '',
            answer: '',
            openList: [],
            usedCharacterList: [],
            triesLeft: 0,
        };
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
const openCharacter = async (character) => {
    if (state.usedCharacterList.includes(character)) {
        return 'invalid';
    }
    const newOpenList = state.openList.slice();
    let letterCount = 0;
    for (const index of range(state.answer.length)) {
        if (state.answer[index] === character) {
            newOpenList[index] = true;
            letterCount += 1;
        }
    }

    const succeeded = (letterCount > 0);

    if (succeeded) {
        await increment(state.challenger, 'hangman-letters', letterCount);
    }

    await setState({
        openList: newOpenList,
        usedCharacterList: state.usedCharacterList.concat([character]),
        triesLeft: state.triesLeft - (succeeded ? 0 : 1),
    });
    
    return succeeded ? 'success' : 'failure';
};

//guess the whole string
const guessAnswer = async (candidate) => {
    const succeeded = (state.answer === candidate);
    if (succeeded) {
        const countUnique = (iterable) => {
            return new Set(iterable).size;
        }
        const closedChars = state.answer.split('').filter((character, index) => !state.openList[index]);
        if (countUnique(closedChars) >= 3) {
            await unlock(state.challenger, 'hangman-multiple-letters');
        }
        return 'success';
    } 
    else {
        await setState({
            triesLeft: state.triesLeft - 1,
        });
        return 'failure';
    }
};

const getOpenListString = () => {
    return '`' + state.openList.map((flag, index) => (flag ? state.answer[index] : '_')).join(' ') + '`';
};

const getUsedString = () => {
    return state.usedCharacterList.map(character => '`' + character + '`').join(' ') ;
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

const resetConsecutiveAchievements = async () => {
    await set(state.challenger, 'hangman-consecutive', 0);
    if (state.openList.every(x => !x)) {
        await unlock(state.challenger, 'hangman-reverse-perfect');
    }
};

const unlockGameAchievements = async () => {
    await increment(state.challenger, 'hangman-clear');
    if (state.diffValue === 'hard' || state.diffValue === 'extreme') {
        await increment(state.challenger, 'hangman-consecutive');
    }
    if (state.triesLeft === numberOfTries) {
        await unlock(state.challenger, 'hangman-perfect');
    }
    if (state.answer.length <= 6) {
        await unlock(state.challenger, 'hangman-short');
    }
    if (state.answer.match(/[xzjq]/)) {
        await unlock(state.challenger, 'hangman-xzjq');
    }
    if (state.diffValue === 'extreme') {
        await unlock(state.challenger, 'hangman-extreme-clear');
    }
};

module.exports = ({ rtmClient: rtm, webClient: slack }) => {
    const postMessage = (text, options) => slack.chat.postMessage({
        channel: process.env.CHANNEL_SANDBOX,
        text,
        username: 'hangmanbot',
        // eslint-disable-next-line camelcase
        icon_emoji: ':capital_abcd:',
        ...(options ? options : {}),
        ...(state.thread ? { thread_ts: state.thread } : {}),
    });

    const postGameStatus = async (header) => {
        return await postMessage(stripIndents`${header}
                現在の状態: ${getOpenListString()}
                使った文字: ${getUsedString()}
                残機: ${state.triesLeft}`);
    };

    const postGameResult = async (header) => {
        return await postMessage(stripIndents`${header}
                    答えは \`${state.answer}\` でした `, {reply_broadcast: true});
    };

    rtm.on('message', async (message) => {
        if (message.channel !== process.env.CHANNEL_SANDBOX) {
            return;
        }

        if (!message.text) {
            return;
        }

        if (message.username === 'hangmanbot') {
            return;
        }

        if (!message.user) {
            return;
        }

        const {text, user} = message;
        
        let matches = null;

        if (matches = text.match(/^hangman(|\s\w*)$/i)) {
            if (state.phase === 'waiting') {
                //string matches "hangman" or "hangman <difficulty>"
                const difficultyString = ((matches[1] === "") ? "medium" : matches[1].slice(1));
                if (!difficultyString.match(/easy|medium|hard|extreme/)) {
                    await postMessage('難易度はeasy/medium/hard/extremeのどれかを指定してね');
                    return;
                }

                const wordList = await getDictionary();

                const word = getRandomWord(difficultyString, wordList);
                
                const wordLength = word.length;
                await setState({
                    phase: 'playing',
                    challenger: user,
                    diffValue: difficultyString,
                    answer: word,
                    openList: Array(wordLength).fill(false),
                    usedCharacterList: [],
                    triesLeft: numberOfTries,
                });

                const { ts } = await postGameStatus('Hangmanを始めるよ！正解の英単語を当てよう！');

                await setState({
                    thread: ts
                });

                await postMessage(stripIndents`答え方
                小文字アルファベットを書く: \`x\`
                単語を丸ごと宣言する: \`!word\``);

                const currentThread = state.thread;
                setTimeout(async () => {
                    if (currentThread === state.thread) {
                        await postGameResult(':clock3: タイムオーバー :sweat:');
                        await resetConsecutiveAchievements();
                        await setState({
                            phase: 'waiting',
                            challenger: null,
                            thread: null,
                            diffValue: '',
                            answer: '',
                            openList: [],
                            usedCharacterList: [],
                            triesLeft: 0,
                        });
                    }
                }, 4 * 60 * 1000);
                
                return;
            }
        }
        if (text.match(/^[a-z]$/)) {
            if (state.phase !== 'playing') {
                return;
            }
            if (state.challenger !== user) {
                return;
            }
            const response = await openCharacter(text);
            if (response === 'success') {
                if (!state.openList.every(x => x)) {
                    postGameStatus(':ok:');
                    return;
                }
                else {
                    await postGameResult(':tada: 正解！ :partying_face:');
                    await unlockGameAchievements();
                    await setState({
                        phase: 'waiting',
                        challenger: null,
                        thread: null,
                        diffValue: '',
                        answer: '',
                        openList: [],
                        usedCharacterList: [],
                        triesLeft: 0,
                    });
                    return;
                }
            } 
            else if (response === 'failure') {
                if (state.triesLeft > 0) {
                    await postGameStatus(':ng: 間違っています :ng:');
                    return;
                }
                else {
                    await postGameResult(':cry: ゲームオーバー :pensive:');
                    await resetConsecutiveAchievements();
                    await setState({
                        phase: 'waiting',
                        challenger: null,
                        thread: null,
                        diffValue: '',
                        answer: '',
                        openList: [],
                        usedCharacterList: [],
                        triesLeft: 0,
                    });
                    return;
                }
            }
            else {
                postGameStatus(':thinking_face: その手はよくわからないよ :thinking_face:');
                return;
            }
        }
        if (matches = text.match(/^!([a-z]+)/)) {
            if (state.phase !== 'playing') {
                return;
            }
            if (state.challenger !== user) {
                return;
            }
            const response = await guessAnswer(matches[1]);
            if (response === 'success') {
                postGameResult(':tada: 正解！ :astonished:');
                await unlockGameAchievements();
                await setState({
                    phase: 'waiting',
                    challenger: null,
                    thread: null,
                    diffValue: '',
                    answer: '',
                    openList: [],
                    usedCharacterList: [],
                    triesLeft: 0,
                });
                return;
            }
            else if (response === 'failure') {
                if (state.triesLeft > 0) {
                    postGameStatus(':ng: 失敗です…… :ng:');
                    return;
                }
                else {
                    postGameResult(':cry: ゲームオーバー :pensive:');
                    await resetConsecutiveAchievements();
                    await setState({
                        phase: 'waiting',
                        challenger: null,
                        thread: null,
                        diffValue: '',
                        answer: '',
                        openList: [],
                        usedCharacterList: [],
                        triesLeft: 0,
                    });
                    return;
                }
            } 
            else {
                postGameStatus(':thinking_face: その手はよくわからないよ :thinking_face:');
                return;
            }
        }
        if (text === "reset hangman") {
            logger.info("resetting Sadge");
            await setState({
                phase: 'waiting',
                challenger: null,
                thread: null,
                diffValue: '',
                answer: '',
                openList: [],
                usedCharacterList: [],
                triesLeft: 0,
            });
            return;
        }
    });
};