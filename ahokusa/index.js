"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = require("lodash");
const achievements_1 = require("../achievements");
const channelLimitedBot_1 = require("../lib/channelLimitedBot");
const slackUtils_1 = require("../lib/slackUtils");
const completeBoards = {
    ahokusa: [
        [
            ':ahokusa-top-left:',
            ':ahokusa-top-center:',
            ':ahokusa-top-right:',
        ],
        [
            ':ahokusa-bottom-left:',
            ':ahokusa-bottom-center:',
            ':ahokusa-bottom-right:',
        ],
    ],
    sushi3: [
        [
            ':sushi-top-left:',
            ':sushi-top-center:',
            ':sushi-top-right:',
        ],
        [
            ':sushi-middle-left:',
            ':sushi-middle-center:',
            ':sushi-middle-right:',
        ],
        [
            ':sushi-bottom-left:',
            ':sushi-bottom-center:',
            ':sushi-bottom-right:',
        ],
    ],
    sushi4: Array(4).fill(null).map((_, y) => Array(4).fill(null).map((_, x) => `:sushi-4-${x}-${y}:`)),
    sushi5: Array(5).fill(null).map((_, y) => Array(5).fill(null).map((_, x) => `:sushi-5_${x}_${y}:`)),
    sushi6: Array(6).fill(null).map((_, y) => Array(6).fill(null).map((_, x) => `:sushi-6-${x}-${y}:`)),
    chiya: Array(4).fill(null).map((_, y) => Array(3).fill(null).map((_, x) => `:chiya-kirarafantasia-${x}-${y}:`)),
};
const getBoardSize = (board) => ({
    height: board.length,
    width: board[0].length,
});
const getPiecePosition = (board, piece) => {
    const { height, width } = getBoardSize(board);
    for (let ay = 0; ay < height; ay++) {
        for (let ax = 0; ax < width; ax++) {
            if (board[ay][ax] === piece) {
                return [ax, ay];
            }
        }
    }
    throw new Error('the piece not found');
};
const getMovedBoard = (board, dir) => {
    const { height, width } = getBoardSize(board);
    const [x, y] = getPiecePosition(board, ':void:');
    const directionMap = {
        上: [0, -1],
        w: [0, -1],
        k: [0, -1],
        下: [0, 1],
        s: [0, 1],
        j: [0, 1],
        左: [-1, 0],
        a: [-1, 0],
        h: [-1, 0],
        右: [1, 0],
        d: [1, 0],
        l: [1, 0],
    };
    const [dx, dy] = directionMap[dir];
    const nx = x - dx;
    const ny = y - dy;
    if (nx < 0 || width <= nx || ny < 0 || height <= ny) {
        throw new Error(':ha:');
    }
    const newBoard = (0, lodash_1.cloneDeep)(board);
    newBoard[y][x] = newBoard[ny][nx];
    newBoard[ny][nx] = ':void:';
    return newBoard;
};
const isFinishedBoard = (board, completeBoard) => board.every((row, y) => row.every((cell, x) => (cell === completeBoard[y][x] || cell === ':void:')));
const getBoardString = (board) => board.map((row) => row.join('')).join('\n');
const reverseDirection = (dir) => ({
    上: '下',
    下: '上',
    左: '右',
    右: '左',
}[dir]);
const ahokusaHandMap = (() => {
    const result = new Map();
    const queue = [];
    const completeBoard = completeBoards.ahokusa;
    const { height, width } = getBoardSize(completeBoard);
    for (let i = 0; i < height * width; i++) {
        const brokenPieces = (0, lodash_1.flatten)(completeBoard);
        brokenPieces[i] = ':void:';
        const brokenBoard = (0, lodash_1.chunk)(brokenPieces, width);
        result.set(getBoardString(brokenBoard), [0, []]);
        queue.push(brokenBoard);
    }
    while (queue.length) {
        const board = queue.shift();
        const boardStr = getBoardString(board);
        for (const dir of ['上', '下', '左', '右']) {
            let newBoard = null;
            try {
                newBoard = getMovedBoard(board, dir);
            }
            catch (e) {
                if (e instanceof Error && e.message === ':ha:') {
                    continue;
                }
                throw e;
            }
            const newBoardStr = getBoardString(newBoard);
            if (result.has(newBoardStr)) {
                const [hand, dirs] = result.get(newBoardStr);
                if (hand === result.get(boardStr)[0] + 1) {
                    dirs.push(reverseDirection(dir));
                }
            }
            else {
                result.set(newBoardStr, [result.get(boardStr)[0] + 1, [reverseDirection(dir)]]);
                queue.push(newBoard);
            }
        }
    }
    return result;
})();
const isSolvableBoard = (board, completeBoard) => {
    const getParity = (a1, a2_) => {
        const a2 = a2_.slice();
        const inv_a2 = (0, lodash_1.invert)(a2);
        const swap_a2 = (i, j) => {
            const tmp = a2[i];
            a2[i] = a2[j];
            a2[j] = tmp;
            inv_a2[a2[i]] = i;
            inv_a2[a2[j]] = j;
        };
        let inversions = 0;
        a1.forEach((elem, i) => {
            if (a2[i] !== elem) {
                const j = inv_a2[elem];
                swap_a2(i, j);
                inversions++;
            }
        });
        return inversions % 2;
    };
    const pieces = (0, lodash_1.flatten)(board);
    const lackedPiece = (0, lodash_1.flatten)(completeBoard).find((piece) => !pieces.includes(piece));
    const parity = getParity((0, lodash_1.flatten)(completeBoard), (0, lodash_1.flatten)(board).map((piece) => piece === ':void:' ? lackedPiece : piece));
    const [x0, y0] = getPiecePosition(completeBoard, lackedPiece);
    const [x1, y1] = getPiecePosition(board, ':void:');
    return (parity + (x0 - x1) + (y0 - y1)) % 2 === 0;
};
const shuffleBoard = (boardName) => {
    const completeBoard = completeBoards[boardName];
    const { width } = getBoardSize(completeBoard);
    const brokenPieces = (0, lodash_1.flatten)(completeBoard);
    brokenPieces[(0, lodash_1.random)(brokenPieces.length - 1)] = ':void:';
    let board = null;
    do {
        board = (0, lodash_1.chunk)((0, lodash_1.shuffle)(brokenPieces), width);
    } while (isFinishedBoard(board, completeBoard));
    return board;
};
const isValidBoard = (board, completeBoard) => {
    const givenPieces = (0, lodash_1.flatten)(board);
    const okPieces = (0, lodash_1.flatten)(completeBoard);
    return givenPieces.length === okPieces.length &&
        givenPieces.length === (0, lodash_1.uniq)(givenPieces).length &&
        givenPieces.filter((piece) => piece === ':void:').length === 1 &&
        givenPieces.filter((piece) => piece !== ':void:').every((piece) => okPieces.includes(piece));
};
class AhokusaBot extends channelLimitedBot_1.ChannelLimitedBot {
    state = {
        board: null,
        startBoard: null,
        hand: 0,
        startDate: null,
        lackedPiece: ':ahokusa-top-center:',
        seen: 0,
        usedHelp: false,
        boardName: 'ahokusa',
        thread: null,
        channel: null,
    };
    wakeWordRegex = /^(あほくさスライドパズル|寿司スライドパズル( [3456])?|千矢スライドパズル|@ahokusa\b[\s\S]*)$/;
    username = 'ahokusa';
    iconEmoji = ':ahokusa-top-center:';
    progressMessageChannel = undefined;
    async onWakeWord(message, channel) {
        const { user, text } = message;
        this.log.info(`Received wake word message: ${text} from user: ${user} in channel: ${message.channel}`);
        // Handle @ahokusa commands
        if (text?.startsWith('@ahokusa')) {
            const command = text.replace(/^@ahokusa\s*/, '');
            // Handle hint command (only in thread)
            if (command === 'ヒント' && message.thread_ts && this.state.thread === message.thread_ts) {
                if (this.state.board === null || this.state.boardName !== 'ahokusa') {
                    await this.postMessage({
                        channel,
                        text: ':ha:',
                        username: 'ahokusa',
                        ...(this.state.boardName === 'ahokusa' ? {} : { icon_emoji: ':ahokusa-top-center:' }),
                        thread_ts: message.thread_ts,
                    });
                    return null;
                }
                const boardStr = getBoardString(this.state.board);
                if (ahokusaHandMap.has(boardStr)) {
                    const [hand, dirs] = ahokusaHandMap.get(boardStr);
                    await this.postMessage({
                        channel,
                        text: `残り最短${hand}手: ${dirs.join(' or ')}`,
                        username: 'ahokusa',
                        ...(this.state.boardName === 'ahokusa' ? {} : { icon_emoji: ':ahokusa-top-center:' }),
                        thread_ts: message.thread_ts,
                    });
                }
                else {
                    await this.postMessage({
                        channel,
                        text: '残り最短∞手',
                        username: 'ahokusa',
                        ...(this.state.boardName === 'ahokusa' ? {} : { icon_emoji: ':ahokusa-top-center:' }),
                        thread_ts: message.thread_ts,
                    });
                }
                this.state.usedHelp = true;
                return null;
            }
            // Handle custom board initialization by emojis
            const completeBoard = completeBoards.ahokusa;
            if (new RegExp(`^((${(0, lodash_1.flatten)(completeBoard).map((str) => (0, lodash_1.escapeRegExp)(str)).join('|')}|:void:)\\s*)+$`).test(command)) {
                const { width } = getBoardSize(completeBoard);
                const board = (0, lodash_1.chunk)(command.match(new RegExp(`${(0, lodash_1.flatten)(completeBoard).map((str) => (0, lodash_1.escapeRegExp)(str)).join('|')}|:void:`, 'g')), width);
                if (!isValidBoard(board, completeBoard) || isFinishedBoard(board, completeBoard)) {
                    await this.postMessage({
                        channel,
                        text: ':ha:',
                        username: 'ahokusa',
                        icon_emoji: ':ahokusa-top-center:',
                    });
                    return null;
                }
                const pieces = (0, lodash_1.flatten)(board);
                const lackedPiece = (0, lodash_1.flatten)(completeBoard).find((piece) => !pieces.includes(piece));
                const boardText = getBoardString(board);
                const response = await this.postMessage({
                    channel,
                    text: boardText,
                    username: 'ahokusa',
                    icon_emoji: ':ahokusa-top-center:',
                });
                this.state = {
                    board,
                    startBoard: board,
                    boardName: 'ahokusa',
                    hand: 0,
                    seen: 0,
                    usedHelp: true,
                    startDate: Date.now(),
                    lackedPiece,
                    thread: response.message?.thread_ts ?? response.ts,
                    channel,
                };
                return response.ts;
            }
            // Handle custom board initialization by letters
            if ((/^([あほくさ_#.]\s*)+$/).test(command)) {
                const { width } = getBoardSize(completeBoard);
                const charMap = {
                    あ: ':ahokusa-top-right:',
                    ほ: ':ahokusa-bottom-right:',
                    く: ':ahokusa-top-left:',
                    さ: ':ahokusa-bottom-left:',
                    _: ':ahokusa-top-center:',
                    '#': ':ahokusa-bottom-center:',
                    '.': ':void:',
                };
                const board = (0, lodash_1.chunk)(command.match(/[あほくさ_#.]/g).map((c) => charMap[c]), width);
                if (!isValidBoard(board, completeBoard) || isFinishedBoard(board, completeBoard)) {
                    await this.postMessage({
                        channel,
                        text: ':ha:',
                        username: 'ahokusa',
                        icon_emoji: ':ahokusa-top-center:',
                    });
                    return null;
                }
                const pieces = (0, lodash_1.flatten)(board);
                const lackedPiece = (0, lodash_1.flatten)(completeBoard).find((piece) => !pieces.includes(piece));
                const boardText = getBoardString(board);
                const response = await this.postMessage({
                    channel,
                    text: boardText,
                    username: 'ahokusa',
                    icon_emoji: ':ahokusa-top-center:',
                });
                this.state = {
                    board,
                    startBoard: board,
                    boardName: 'ahokusa',
                    hand: 0,
                    seen: 0,
                    usedHelp: true,
                    startDate: Date.now(),
                    lackedPiece,
                    thread: response.message?.thread_ts ?? response.ts,
                    channel,
                };
                return response.ts;
            }
            // Invalid @ahokusa command
            await this.postMessage({
                channel,
                text: ':ha:',
                username: 'ahokusa',
                icon_emoji: ':ahokusa-top-center:',
                thread_ts: message.ts,
            });
            return null;
        }
        if (this.state.board !== null && this.state.thread !== null) {
            const url = `<https://tsg-ut.slack.com/archives/${this.state.channel}/p${this.state.thread.replace('.', '')}|ここ>`;
            await this.postMessage({
                channel,
                text: `既に${url}で起動中だよ`,
                thread_ts: message.ts,
            });
            return null;
        }
        let boardName;
        if (text === 'あほくさスライドパズル') {
            boardName = 'ahokusa';
            await (0, achievements_1.unlock)(user, 'ahokusa-play');
        }
        else if (text === '寿司スライドパズル') {
            boardName = (0, lodash_1.sample)(['sushi3', 'sushi4', 'sushi5', 'sushi6']);
        }
        else if (text?.startsWith('寿司スライドパズル ')) {
            const match = text.match(/^寿司スライドパズル ([3456])$/);
            const size = match ? match[1] : undefined;
            boardName = `sushi${size}`;
        }
        else if (text === '千矢スライドパズル') {
            boardName = 'chiya';
        }
        else {
            return null;
        }
        const board = shuffleBoard(boardName);
        const completeBoard = completeBoards[boardName];
        const pieces = (0, lodash_1.flatten)(board);
        const lackedPiece = (0, lodash_1.flatten)(completeBoard).find((piece) => !pieces.includes(piece));
        const boardText = getBoardString(board);
        const response = await this.postMessage({
            channel,
            text: boardText,
            username: boardName === 'ahokusa' ? 'ahokusa' : boardName === 'chiya' ? 'chiya' : 'sushi-puzzle',
            icon_emoji: lackedPiece,
            ...(message.channel === channel ? { thread_ts: message.ts } : {}),
        });
        this.state = {
            board,
            startBoard: board,
            boardName,
            hand: 0,
            seen: 0,
            usedHelp: false,
            startDate: Date.now(),
            lackedPiece,
            thread: response.message?.thread_ts ?? response.ts,
            channel,
        };
        if (message.channel !== channel) {
            await this.postMessage({
                channel,
                text: 'ヒントコマンド: `@ahokusa ヒント`',
                thread_ts: response.ts,
            });
        }
        return response.ts;
    }
    async onMessageEvent(event) {
        await super.onMessageEvent(event);
        const message = (0, slackUtils_1.extractMessage)(event);
        if (message === null ||
            !message.text ||
            !message.user ||
            message.bot_id !== undefined ||
            !(0, slackUtils_1.isGenericMessage)(message)) {
            return;
        }
        if (message.text === 'スライドパズル爆破' || message.text === 'あ　ほ　く　さ') {
            this.state = {
                ...this.state,
                board: null,
                thread: null,
                channel: null,
            };
            await this.slack.reactions.add({
                name: 'boom',
                channel: message.channel,
                timestamp: message.ts,
            });
            return;
        }
        // Skip if not in a thread or not the active thread
        if (!message.thread_ts || this.state.thread !== message.thread_ts) {
            return;
        }
        // Skip if not in allowed channel
        if (!this.allowedChannels.includes(message.channel)) {
            return;
        }
        const { user, text, channel, ts } = message;
        const thread = message.thread_ts;
        if (text === 'もう一度') {
            if (this.state.startBoard === null) {
                await this.postThreadMessage(channel, thread, ':ha:');
                return;
            }
            this.state = {
                ...this.state,
                board: this.state.startBoard,
                hand: 0,
                seen: 0,
                usedHelp: true,
            };
            await this.postBoardMessage(channel, thread);
            return;
        }
        if (text === '不成立' || text === 'f') {
            if (this.state.board === null) {
                await this.postThreadMessage(channel, thread, ':ha:');
                return;
            }
            if (isSolvableBoard(this.state.startBoard, completeBoards[this.state.boardName])) {
                await this.postThreadMessage(channel, thread, ':seyaroka: ペナルティ: +5秒');
                this.state.startDate = this.state.startDate - 5000;
            }
            else {
                const time = (Date.now() - this.state.startDate) / 1000;
                await this.slack.reactions.add({
                    name: 'seyana',
                    channel,
                    timestamp: ts,
                });
                await this.postThreadMessage(channel, thread, `:tada: ${(0, lodash_1.round)(time, 2).toFixed(2)}秒` +
                    `${this.state.seen === 0 ? '、一発' : ''}`, { reply_broadcast: true });
                await this.deleteProgressMessage(this.state.thread);
                this.state.board = null;
                if (!this.state.usedHelp) {
                    if (this.state.boardName === 'ahokusa') {
                        await (0, achievements_1.unlock)(user, 'ahokusa-impossible');
                        if (this.state.seen === 0)
                            await (0, achievements_1.unlock)(user, 'ahokusa-impossible-once');
                        if (time < 5)
                            await (0, achievements_1.unlock)(user, 'ahokusa-impossible-5s');
                    }
                    else if (this.state.boardName === 'chiya') {
                        if (this.state.seen === 0)
                            await (0, achievements_1.unlock)(user, 'ahokusa-chiya-impossible-once');
                    }
                }
            }
            return;
        }
        if ((/^([上下左右wasdhjkl]\d*)+$/).test(text)) {
            if (this.state.board === null) {
                return;
            }
            try {
                let { board, hand } = this.state;
                const { height, width } = getBoardSize(board);
                const matches = Array.from(text.matchAll(/([上下左右wasdhjkl])(\d*)/g));
                for (const matchArray of matches) {
                    const dir = matchArray[1];
                    const amount = parseInt(matchArray[2] || '1');
                    if (amount === 0 || (amount >= width && amount >= height)) {
                        throw new Error(':ha:');
                    }
                    for (let i = 0; i < amount; i++) {
                        board = getMovedBoard(board, dir);
                        hand++;
                    }
                }
                this.state = {
                    ...this.state,
                    board,
                    hand,
                    seen: this.state.seen + 1,
                };
            }
            catch (e) {
                if (e instanceof Error && e.message === ':ha:') {
                    await this.postThreadMessage(channel, thread, e.message);
                    return;
                }
                throw e;
            }
            await this.postBoardMessage(channel, thread);
            if (isFinishedBoard(this.state.board, completeBoards[this.state.boardName])) {
                const time = (Date.now() - this.state.startDate) / 1000;
                let minHandInfo = '';
                if (this.state.boardName === 'ahokusa') {
                    const minHand = ahokusaHandMap.get(getBoardString(this.state.startBoard))[0];
                    minHandInfo = `（${this.state.hand === minHand ? ':tada:最短' : `最短：${minHand}手`}）`;
                }
                await this.postThreadMessage(channel, thread, `:tada: ${(0, lodash_1.round)(time, 2).toFixed(2)}秒、` +
                    `${this.state.hand}手${minHandInfo}` +
                    `${this.state.seen === 1 ? '、一発' : ''}`, { reply_broadcast: true });
                await this.deleteProgressMessage(this.state.thread);
                if (!this.state.usedHelp) {
                    if (this.state.boardName === 'ahokusa') {
                        const minHand = ahokusaHandMap.get(getBoardString(this.state.startBoard))[0];
                        await (0, achievements_1.unlock)(user, 'ahokusa-clear');
                        if (this.state.hand === minHand)
                            await (0, achievements_1.unlock)(user, 'ahokusa-clear-shortest');
                        if (this.state.seen === 1)
                            await (0, achievements_1.unlock)(user, 'ahokusa-clear-once');
                        if (this.state.seen === 1 && this.state.hand === minHand)
                            await (0, achievements_1.unlock)(user, 'ahokusa-clear-shortest-once');
                        if (time < 8)
                            await (0, achievements_1.unlock)(user, 'ahokusa-clear-8s');
                    }
                    else if (this.state.boardName === 'sushi3' || this.state.boardName === 'sushi4' || this.state.boardName === 'sushi5' || this.state.boardName === 'sushi6') {
                        if (this.state.seen === 1 && time < 89)
                            await (0, achievements_1.unlock)(user, 'ahokusa-sushi-clear-once-89s');
                    }
                    else if (this.state.boardName === 'chiya') {
                        await (0, achievements_1.unlock)(user, 'ahokusa-chiya-clear');
                        if (time < 200)
                            await (0, achievements_1.unlock)(user, 'ahokusa-chiya-clear-200s');
                        if (time < 50)
                            await (0, achievements_1.unlock)(user, 'ahokusa-chiya-clear-50s');
                        if (this.state.seen === 1 && time < 1008)
                            await (0, achievements_1.unlock)(user, 'ahokusa-chiya-clear-once-1008s');
                    }
                }
                this.state.board = null;
            }
        }
    }
    async postThreadMessage(channel, thread, text, opt = {}) {
        await this.postMessage({
            channel,
            text,
            username: this.state.boardName === 'ahokusa' ? 'ahokusa' : this.state.boardName === 'chiya' ? 'chiya' : 'sushi-puzzle',
            icon_emoji: this.state.lackedPiece,
            thread_ts: thread,
            ...opt,
        });
    }
    async postBoardMessage(channel, thread) {
        const boardText = getBoardString(this.state.board);
        await this.postThreadMessage(channel, thread, boardText);
    }
}
exports.default = (slackClients) => {
    return new AhokusaBot(slackClients);
};
