
const { random, range } = require('lodash');
const { promises: fs, constants } = require('fs');
const { promisify } = require('util');
const path = require('path');
const download = require('download');
const { stripIndents } = require("common-tags");

const state = (() => {
    try {
        const savedState = require('./state.json');
        return {
            phase: savedState.phase,
            challenger: savedState.challenger || null,
            thread: savedState.thread || null,
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

const HangmanResponse = {
    Invalid: -1,
    Success: 0,
    Failure: 1,
};

//open a character
const openCharacter = async (character) => {
    if (state.usedCharacterList.includes(character)) {
        return HangmanResponse.Invalid;
    }
    var newOpenList = state.openList.slice();
    var letterCount = 0;
    for (const index in range(state.answer.length)) {
        if (state.answer[index] == character) {
            newOpenList[index] = true;
            letterCount += 1;
        }
    }

    const succeeded = (letterCount > 0);
    await setState({
        openList: newOpenList,
        usedCharacterList: state.usedCharacterList.concat([character]),
        triesLeft: state.triesLeft - (succeeded ? 0 : 1),
    });
    
    
    return succeeded ? HangmanResponse.Success : HangmanResponse.Failure;
};

//guess the whole string
const guessAnswer = async (candidate) => {
    const succeeded = (state.answer === candidate);
    if (succeeded) {
        return HangmanResponse.Success;
    } 
    else {
        await setState({
            triesLeft: state.triesLeft - 1,
        });
        return HangmanResponse.Failure;
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
        case 0:
            freqLeft = 0;
            freqRight = 1000;
            minLength = 8;
            break;
        case 1:
            freqLeft = 1000;
            freqRight = 3000;
            minLength = 7;
            break;
        case 2:
            freqLeft = 3000;
            freqRight = 5000;
            minLength = 6;
            break;
        case 3:
            freqLeft = 7000;
            freqRight = 10000;
            minLength = 5;
            break;
    }
    if (!wordList) wordList = tmpDictionary;
    console.log(freqLeft + " " + freqRight);
    for (var i = 0; i < 10; i++) {
        const randomIndex = random(freqLeft, freqRight - 1, false);
        const result = wordList[randomIndex % wordList.length];
        console.log(result);
        if (result.length >= minLength && result.match(/^[a-z]+$/)) {
            return result;
        }
    } 
    return 'hangman';
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
                console.log(text);
                //string matches "hangman" or "hangman <difficulity>"
                const difficulityString = ((matches[1] === "") ? "medium" : matches[1].slice(1));
                let diffValue = -1;
                switch (difficulityString) {
                    case "easy": diffValue = 0; break;
                    case "medium": diffValue = 1; break;
                    case "hard": diffValue = 2; break;
                    case "extreme": diffValue = 3; break;
                }
                if (diffValue < 0) {
                    return;
                }

                const wordList = await getDictionary();

                const word = getRandomWord(diffValue, wordList);
                
                const wordLength = word.length;
                await setState({
                    phase: 'playing',
                    challenger: user,
                    answer: word,
                    openList: Array(wordLength).fill(false),
                    usedCharacterList: [],
                    triesLeft: numberOfTries,
                });

                console.log("after");
                const { ts } = await postGameStatus('Hangmanを始めるよ！正解の英単語を当てよう！');

                await setState({
                    thread: ts
                });
                
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
            console.log(getOpenListString());
            if (response === HangmanResponse.Success) {
                if (!state.openList.every(x => x)) {
                    postGameStatus(':ok:');
                    return;
                }
                else {
                    postGameResult(':tada: 正解！ :partying_face:');
                    await setState({
                        phase: 'waiting',
                        challenger: null,
                        thread: null,
                        answer: '',
                        openList: [],
                        usedCharacterList: [],
                        triesLeft: 0,
                    });
                    return;
                }
            } 
            else if (response === HangmanResponse.Failure) {
                if (state.triesLeft > 0) {
                    postGameStatus(':ng: 間違っています :ng:');
                    return;
                }
                else {
                    postGameResult(':cry: ゲームオーバー :pensive:');
                    await setState({
                        phase: 'waiting',
                        challenger: null,
                        thread: null,
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
            if (response === HangmanResponse.Success) {
                postGameResult(':tada: 正解！ :astonished:');
                await setState({
                    phase: 'waiting',
                    challenger: null,
                    thread: null,
                    answer: '',
                    openList: [],
                    usedCharacterList: [],
                    triesLeft: 0,
                });
                return;
            }
            else if (response === HangmanResponse.Failure) {
                if (state.triesLeft > 0) {
                    postGameStatus(':ng: 失敗です…… :ng:');
                    return;
                }
                else {
                    postGameResult(':cry: ゲームオーバー :pensive:');
                    await setState({
                        phase: 'waiting',
                        challenger: null,
                        thread: null,
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
        if (text == "reset hangman") {
            console.log("resetting Sadge");
            await setState({
                phase: 'waiting',
                challenger: null,
                thread: null,
                answer: '',
                openList: [],
                usedCharacterList: [],
                triesLeft: 0,
            });
            return;
        }
    });
};