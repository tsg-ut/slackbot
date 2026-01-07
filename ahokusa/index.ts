import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { chunk, cloneDeep, escapeRegExp, flatten, invert, random, round, sample, shuffle, uniq } from 'lodash';
import { GenericMessageEvent, MessageEvent, ChatPostMessageArguments } from '@slack/web-api';
import { unlock } from '../achievements';
import { ChannelLimitedBot } from '../lib/channelLimitedBot';
import { SlackInterface } from '../lib/slack';
import { extractMessage, isGenericMessage } from '../lib/slackUtils';

type Board = string[][];

interface State {
    board: Board | null;
    startBoard: Board | null;
    hand: number;
    startDate: number | null;
    lackedPiece: string;
    seen: number;
    usedHelp: boolean;
    boardName: string;
    thread: string | null;
    channel: string | null;
}

const completeBoards: { [key: string]: Board } = {
    ahokusa: [
        [':ahokusa-top-left:', ':ahokusa-top-center:', ':ahokusa-top-right:'],
        [':ahokusa-bottom-left:', ':ahokusa-bottom-center:', ':ahokusa-bottom-right:'],
    ],
    sushi3: [
        [':sushi-top-left:', ':sushi-top-center:', ':sushi-top-right:'],
        [':sushi-middle-left:', ':sushi-middle-center:', ':sushi-middle-right:'],
        [':sushi-bottom-left:', ':sushi-bottom-center:', ':sushi-bottom-right:'],
    ],
    sushi4: Array(4).fill(null).map((_, y) => Array(4).fill(null).map((_, x) => `:sushi-4-${x}-${y}:`)),
    sushi5: Array(5).fill(null).map((_, y) => Array(5).fill(null).map((_, x) => `:sushi-5_${x}_${y}:`)),
    sushi6: Array(6).fill(null).map((_, y) => Array(6).fill(null).map((_, x) => `:sushi-6-${x}-${y}:`)),
    chiya: Array(4).fill(null).map((_, y) => Array(3).fill(null).map((_, x) => `:chiya-kirarafantasia-${x}-${y}:`)),
};

class AhokusaBot extends ChannelLimitedBot {
    private state: State = this.loadState();

    protected override wakeWordRegex = /^(あほくさ|寿司|千矢)スライドパズル( (?<size>[3456]))?$/;

    constructor(slackClients: SlackInterface) {
        super(slackClients);
    }

    private loadState(): State {
        try {
            const savedState = JSON.parse(fs.readFileSync(path.join(__dirname, 'state.json'), 'utf8'));
            return {
                board: savedState.board || null,
                startBoard: savedState.startBoard || null,
                hand: savedState.hand || 0,
                startDate: savedState.startDate || null,
                lackedPiece: savedState.lackedPiece || ':ahokusa-top-center:',
                seen: savedState.seen || 0,
                usedHelp: savedState.usedHelp || false,
                boardName: savedState.boardName || 'ahokusa',
                thread: savedState.thread || null,
                channel: savedState.channel || null,
            };
        } catch (e) {
            return {
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
        }
    }

    private async setState(newState: Partial<State>) {
        Object.assign(this.state, newState);
        await promisify(fs.writeFile)(
            path.join(__dirname, 'state.json'),
            JSON.stringify(this.state)
        );
    }

    private getBoardSize(board: Board) {
        return {
            height: board.length,
            width: board[0].length,
        };
    }

    private getPiecePosition(board: Board, piece: string): [number, number] {
        const { height, width } = this.getBoardSize(board);
        for (let ay = 0; ay < height; ay++) {
            for (let ax = 0; ax < width; ax++) {
                if (board[ay][ax] === piece) {
                    return [ax, ay];
                }
            }
        }
        throw new Error('the piece not found');
    }

    private getMovedBoard(board: Board, dir: string): Board {
        const { height, width } = this.getBoardSize(board);
        const [x, y] = this.getPiecePosition(board, ':void:');
        const [dx, dy] = {
            '上': [0, -1], 'w': [0, -1], 'k': [0, -1],
            '下': [0, 1], 's': [0, 1], 'j': [0, 1],
            '左': [-1, 0], 'a': [-1, 0], 'h': [-1, 0],
            '右': [1, 0], 'd': [1, 0], 'l': [1, 0],
        }[dir]!;
        const nx = x - dx;
        const ny = y - dy;
        if (nx < 0 || width <= nx || ny < 0 || height <= ny) {
            throw new Error(':ha:');
        }
        const newBoard = cloneDeep(board);
        newBoard[y][x] = newBoard[ny][nx];
        newBoard[ny][nx] = ':void:';
        return newBoard;
    }

    private async move(text: string) {
        let { board, hand } = this.state;
        if (!board) return;
        const { height, width } = this.getBoardSize(board);
        for (let matchArray, re = /([上下左右wasdhjkl])(\d*)/g; (matchArray = re.exec(text));) {
            const dir = matchArray[1];
            const amount = parseInt(matchArray[2] || '1');
            if (amount === 0 || (amount >= width && amount >= height)) {
                throw new Error(':ha:');
            }
            for (let i = 0; i < amount; i++) {
                board = this.getMovedBoard(board, dir);
                hand++;
            }
        }
        await this.setState({ board, hand, seen: this.state.seen + 1 });
    }

    private isFinishedBoard(board: Board, completeBoard: Board = completeBoards[this.state.boardName]): boolean {
        return board.every((row, y) => row.every((cell, x) => (
            cell === completeBoard[y][x] || cell === ':void:'
        )));
    }

    private getBoardString(board: Board): string {
        return board.map((row) => row.join('')).join('\n');
    }

    private reverseDirection(dir: string): string {
        return {
            '上': '下', '下': '上', '左': '右', '右': '左',
        }[dir]!;
    }

    private ahokusaHandMap = (() => {
        const result = new Map<string, [number, string[]]>();
        const queue: Board[] = [];

        const completeBoard = completeBoards.ahokusa;
        const { height, width } = this.getBoardSize(completeBoard);
        for (let i = 0; i < height * width; i++) {
            const brokenPieces = flatten(completeBoard);
            brokenPieces[i] = ':void:';
            const brokenBoard = chunk(brokenPieces, width);
            result.set(this.getBoardString(brokenBoard), [0, []]);
            queue.push(brokenBoard);
        }
        while (queue.length) {
            const board = queue.shift()!;
            const boardStr = this.getBoardString(board);
            for (const dir of ['上', '下', '左', '右']) {
                let newBoard: Board | null = null;
                try {
                    newBoard = this.getMovedBoard(board, dir);
                } catch (e) {
                    if ((e as Error).message === ':ha:') {
                        continue;
                    }
                    throw e;
                }
                const newBoardStr = this.getBoardString(newBoard);
                if (result.has(newBoardStr)) {
                    const [hand, dirs] = result.get(newBoardStr)!;
                    if (hand === result.get(boardStr)![0] + 1) {
                        dirs.push(this.reverseDirection(dir));
                    }
                } else {
                    result.set(newBoardStr, [result.get(boardStr)![0] + 1, [this.reverseDirection(dir)]]);
                    queue.push(newBoard);
                }
            }
        }
        return result;
    })();

    private isSolvableBoard(board: Board, completeBoard: Board): boolean {
        const getParity = (a1: string[], a2_: string[]) => {
            const a2 = a2_.slice();
            const inv_a2 = invert(a2);
            const swap_a2 = (i: number, j: number) => {
                const tmp = a2[i];
                a2[i] = a2[j];
                a2[j] = tmp;
                inv_a2[a2[i]] = i.toString();
                inv_a2[a2[j]] = j.toString();
            };
            let inversions = 0;
            a1.forEach((elem, i) => {
                if (a2[i] !== elem) {
                    const j = parseInt(inv_a2[elem]);
                    swap_a2(i, j);
                    inversions++;
                }
            });
            return inversions % 2;
        };
        const pieces = flatten(board);
        const lackedPiece = flatten(completeBoard).find((piece) => !pieces.includes(piece))!;
        const parity = getParity(
            flatten(completeBoard),
            flatten(board).map((piece) => piece === ':void:' ? lackedPiece : piece)
        );

        const [x0, y0] = this.getPiecePosition(completeBoard, lackedPiece);
        const [x1, y1] = this.getPiecePosition(board, ':void:');

        return (parity + (x0 - x1) + (y0 - y1)) % 2 === 0;
    }

    private async setNewBoard(board: Board, boardName: string, usedHelp: boolean) {
        const completeBoard = completeBoards[boardName];
        const pieces = flatten(board);
        await this.setState({
            board,
            startBoard: board,
            boardName,
            hand: 0,
            seen: 0,
            usedHelp,
            startDate: new Date().valueOf(),
            lackedPiece: flatten(completeBoard).find((piece) => !pieces.includes(piece)),
        });
    }

    private async shuffleBoard(boardName: string) {
        const completeBoard = completeBoards[boardName];
        const { width } = this.getBoardSize(completeBoard);
        const brokenPieces = flatten(completeBoard);
        brokenPieces[random(brokenPieces.length - 1)] = ':void:';
        let board: Board;
        do {
            board = chunk(shuffle(brokenPieces), width);
        } while (this.isFinishedBoard(board, completeBoard));
        await this.setNewBoard(board, boardName, false);
    }

    private isValidBoard(board: Board, completeBoard: Board): boolean {
        const givenPieces = flatten(board);
        const okPieces = flatten(completeBoard);
        return givenPieces.length === okPieces.length &&
            givenPieces.length === uniq(givenPieces).length &&
            givenPieces.filter((piece) => piece === ':void:').length === 1 &&
            givenPieces.filter((piece) => piece !== ':void:').every((piece) => okPieces.includes(piece));
    }

    private async postGameMessage(text: string, options: Partial<ChatPostMessageArguments> = {}) {
        await this.slack.chat.postMessage({
            channel: this.state.channel!,
            text,
            username: this.state.boardName === 'ahokusa' ? 'ahokusa' : this.state.boardName === 'chiya' ? 'chiya' : 'sushi-puzzle',
            icon_emoji: this.state.lackedPiece,
            thread_ts: this.state.thread!,
            ...options,
        } as any);
    }

    private async postBoard(options: Partial<ChatPostMessageArguments> = {}) {
        if (!this.state.board) return;
        const boardText = this.getBoardString(this.state.board);
        await this.postGameMessage(boardText, options);
    }

    protected override async onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
        if (this.state.board !== null && this.state.thread !== (message.thread_ts || message.ts)) {
            const url = `<https://tsg-ut.slack.com/archives/${this.state.channel}/p${this.state.thread!.replace('.', '')}|ここ>`;
            await this.slack.chat.postMessage({
                channel: message.channel,
                text: `既に${url}で起動中だよ`,
                username: this.state.boardName === 'ahokusa' ? 'ahokusa' : this.state.boardName === 'chiya' ? 'chiya' : 'sushi-puzzle',
                icon_emoji: this.state.lackedPiece,
                thread_ts: message.ts,
            } as any);
            return null;
        }

        const thread = message.ts;
        await this.setState({ thread, channel });

        const match = message.text!.match(this.wakeWordRegex)!;
        const puzzleType = match[1];
        const size = match[3];

        let boardName: string;
        if (puzzleType === 'あほくさ') {
            boardName = 'ahokusa';
            await unlock(message.user!, 'ahokusa-play');
        } else if (puzzleType === '寿司') {
            boardName = size ? `sushi${size}` : sample(['sushi3', 'sushi4', 'sushi5', 'sushi6'])!;
        } else {
            boardName = 'chiya';
        }

        await this.shuffleBoard(boardName);

        const response = await this.slack.chat.postMessage({
            channel,
            text: this.getBoardString(this.state.board!),
            username: this.state.boardName === 'ahokusa' ? 'ahokusa' : this.state.boardName === 'chiya' ? 'chiya' : 'sushi-puzzle',
            icon_emoji: this.state.lackedPiece,
            thread_ts: thread,
        } as any);

        return response.ts ?? null;
    }

    protected override async onMessageEvent(event: MessageEvent): Promise<void> {
        await super.onMessageEvent(event);
        const message = extractMessage(event);

        if (!isGenericMessage(message) || !message.text || !message.user) {
            return;
        }

        const { user } = message;

        if (message.text === 'スライドパズル爆破' || message.text === 'あ　ほ　く　さ') {
            await this.setState({ board: null, thread: null, channel: null });
            await this.slack.reactions.add({
                name: 'boom',
                channel: message.channel!,
                timestamp: message.ts,
            });
            return;
        }

        if (!message.thread_ts || this.state.thread !== message.thread_ts) {
            return;
        }

        if ((/^@ahokusa\b/).test(message.text)) {
            const command = message.text.replace(/^@ahokusa\s*/, '');
            const postAsAhokusa = (text: string, opt: Partial<ChatPostMessageArguments> = {}) => (
                this.postGameMessage(text, {
                    username: 'ahokusa',
                    ...(this.state.boardName === 'ahokusa' ? {} : { icon_emoji: ':ahokusa-top-center:' }),
                    ...opt,
                } as any)
            );

            if (command === 'ヒント' && message.thread_ts && this.state.thread === message.thread_ts) {
                if (this.state.board === null || this.state.boardName !== 'ahokusa') {
                    await postAsAhokusa(':ha:');
                    return;
                }
                const boardStr = this.getBoardString(this.state.board);
                if (this.ahokusaHandMap.has(boardStr)) {
                    const [hand, dirs] = this.ahokusaHandMap.get(boardStr)!;
                    await postAsAhokusa(`残り最短${hand}手: ${dirs.join(' or ')}`);
                } else {
                    await postAsAhokusa('残り最短∞手');
                }
                await this.setState({
                    usedHelp: true,
                });
                return;
            }

            const completeBoard = completeBoards.ahokusa;
            if (new RegExp(
                `^((${flatten(completeBoard).map((str) => escapeRegExp(str)).join('|')}|:void:)\\s*)+$`
            ).test(command)) {
                const { width } = this.getBoardSize(completeBoard);
                const board = chunk(command.match(new RegExp(`${flatten(completeBoard).map((str) => escapeRegExp(str)).join('|')}|:void:`, 'g'))!, width);
                if (!this.isValidBoard(board, completeBoard) || this.isFinishedBoard(board, completeBoard)) {
                    await postAsAhokusa(':ha:');
                    return;
                }
                await this.setState({ thread: message.ts, channel: message.channel });
                await this.setNewBoard(board, 'ahokusa', true);
                await this.postBoard();
                return;
            }

            if ((/^([あほくさ_#.]\s*)+$/).test(command)) {
                const { width } = this.getBoardSize(completeBoard);
                const board = chunk(command.match(/[あほくさ_#.]/g)!.map((c) => ({
                    'あ': ':ahokusa-top-right:',
                    'ほ': ':ahokusa-bottom-right:',
                    'く': ':ahokusa-top-left:',
                    'さ': ':ahokusa-bottom-left:',
                    '_': ':ahokusa-top-center:',
                    '#': ':ahokusa-bottom-center:',
                    '.': ':void:',
                }[c]!)), width);
                if (!this.isValidBoard(board, completeBoard) || this.isFinishedBoard(board, completeBoard)) {
                    await postAsAhokusa(':ha:');
                    return;
                }
                await this.setState({ thread: message.ts, channel: message.channel });
                await this.setNewBoard(board, 'ahokusa', true);
                await this.postBoard();
                return;
            }
            await postAsAhokusa(':ha:');
            return;
        }

        if (message.text === 'もう一度') {
            if (this.state.startBoard === null) {
                await this.postGameMessage(':ha:');
                return;
            }
            await this.setState({
                board: this.state.startBoard,
                hand: 0,
                seen: 0,
                usedHelp: true,
            });
            await this.postBoard();
            return;
        }

        if (message.text === '不成立' || message.text === 'f') {
            if (this.state.board === null) {
                await this.postGameMessage(':ha:');
                return;
            }

            if (this.isSolvableBoard(this.state.startBoard!, completeBoards[this.state.boardName])) {
                await this.postGameMessage(':seyaroka: ペナルティ: +5秒');
                await this.setState({
                    startDate: this.state.startDate! - 5000,
                });
            } else {
                const time = (new Date().valueOf() - this.state.startDate!) / 1000;
                await this.slack.reactions.add({
                    name: 'seyana',
                    channel: message.channel!,
                    timestamp: message.ts,
                });
                await this.postGameMessage(
                    `:tada: ${round(time, 2).toFixed(2)}秒` +
                    `${this.state.seen === 0 ? '、一発' : ''}`,
                );
                await this.setState({
                    board: null,
                });
                if (!this.state.usedHelp) {
                    if (this.state.boardName === 'ahokusa') {
                        await unlock(user, 'ahokusa-impossible');
                        if (this.state.seen === 0) await unlock(user, 'ahokusa-impossible-once');
                        if (time < 5) await unlock(user, 'ahokusa-impossible-5s');
                    } else if (this.state.boardName === 'chiya') {
                        if (this.state.seen === 0) await unlock(user, 'ahokusa-chiya-impossible-once');
                    }
                }
            }
            return;
        }

        if ((/^([上下左右wasdhjkl]\d*)+$/).test(message.text)) {
            if (this.state.board === null) {
                return;
            }
            try {
                await this.move(message.text);
            } catch (e) {
                if ((e as Error).message === ':ha:') {
                    await this.postGameMessage((e as Error).message);
                    return;
                }
                throw e;
            }
            await this.postBoard();
            if (this.isFinishedBoard(this.state.board!)) {
                const time = (new Date().valueOf() - this.state.startDate!) / 1000;
                let minHandInfo = '';
                if (this.state.boardName === 'ahokusa') {
                    const minHand = this.ahokusaHandMap.get(this.getBoardString(this.state.startBoard!))![0];
                    minHandInfo = `（${this.state.hand === minHand ? ':tada:最短' : `最短：${minHand}手`}）`;
                }
                await this.postGameMessage(
                    `:tada: ${round(time, 2).toFixed(2)}秒、` +
                    `${this.state.hand}手${minHandInfo}` +
                    `${this.state.seen === 1 ? '、一発' : ''}`,
                );
                if (!this.state.usedHelp) {
                    if (this.state.boardName === 'ahokusa') {
                        const minHand = this.ahokusaHandMap.get(this.getBoardString(this.state.startBoard!))![0];
                        await unlock(user, 'ahokusa-clear');
                        if (this.state.hand === minHand) await unlock(user, 'ahokusa-clear-shortest');
                        if (this.state.seen === 1) await unlock(user, 'ahokusa-clear-once');
                        if (this.state.seen === 1 && this.state.hand === minHand) await unlock(user, 'ahokusa-clear-shortest-once');
                        if (time < 8) await unlock(user, 'ahokusa-clear-8s');
                    } else if (this.state.boardName.startsWith('sushi')) {
                        if (this.state.seen === 1 && time < 89) await unlock(user, 'ahokusa-sushi-clear-once-89s');
                    } else if (this.state.boardName === 'chiya') {
                        await unlock(user, 'ahokusa-chiya-clear');
                        if (time < 200) await unlock(user, 'ahokusa-chiya-clear-200s');
                        if (time < 50) await unlock(user, 'ahokusa-chiya-clear-50s');
                        if (this.state.seen === 1 && time < 1008) await unlock(user, 'ahokusa-chiya-clear-once-1008s');
                    }
                }
                await this.setState({
                    board: null,
                });
            }
        }
    }
}

export default async (slackClients: SlackInterface) => {
    new AhokusaBot(slackClients);
};
