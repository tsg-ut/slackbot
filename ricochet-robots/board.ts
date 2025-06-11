'use strict';

import deepcopy from 'deepcopy';
import * as rust_proxy from './rust-proxy';

interface Position {
	x: number,
	y: number,
}

export interface Move {
	c: number,
	d: number,
}

export interface Command {
	moves: Move[],
	isMADE: boolean,
}

export interface BoardSpec {
	depth: number,
	size: {h: number, w: number},
	numOfWalls: number,
}

interface GoalPosition extends Position {
	colour: number,
}

interface WallPosition extends Position {
	d: number,
}

interface BoardData {
	h: number,
	w: number,
	walls: WallPosition[],
	robots: Position[],
}

function rep(n: number,f: (i: number) => void){ for(let i = 0; i < n; i++)f(i); } 

const colournames = [
	'赤','緑','青','黄','黒'
];

const directionnames = [
	'下','右','上','左'
];

function arrays2idxs(arrs: string[][]){
	let res: {[key: string]: number} = {};
	for(const v of arrs){
		for(const k of v.entries()){
			res[k[1]]=k[0];
		}
	}
	//console.log(res);
	return res;
}

const colourname2idx = arrays2idxs([
	colournames,
	["r","g","b","y"],
]);

const directionname2idx = arrays2idxs([
	directionnames,
	["s","d","w","a"],
	['j','l','k','h'],
]);

export const iscommand = (str: string) => {
	return str.match(/^([赤青黄緑rgby]([上下左右wasdhjkl]+))+(まで)?$/);
}

export const str2command = (str: string): Command => {
	const moves = [];
	for (let matchArray, re = /([赤青黄緑rgby])([上下左右wasdhjkl]+)/g; (matchArray = re.exec(str));) {
		//console.log(matchArray);
		for(const d of matchArray[2]){
			moves.push({
				c: colourname2idx[matchArray[1]],
				d: directionname2idx[d],
			});
		}
	}
	//console.log('str2command',str,res);
	return {
		moves: moves,
		isMADE: Boolean(str.match(/まで$/)),
	};
}

function samep(p: Position,q: Position){
	return p.x === q.x && p.y === q.y;
}

export class Board{
	size: {h: number, w: number};
	walls: WallPosition[];
	robots: Position[];
	goal: GoalPosition;
	board: {haswall: boolean[]}[][];
	directions: Position[];
	logs: {c: number, d: number, from: Position, to: Position}[];

	constructor(){}
	load_board(data: BoardData,goalcolour: number,goalpos: GoalPosition) {
		this.size = {
			h: data["h"],
			w: data["w"],
		};
		function pos2array<T extends Position>(x: T){
			return x;
		}
		this.walls = data["walls"].map(pos2array);
		this.robots = data["robots"].map(pos2array);
		this.goal = pos2array(goalpos);
		this.goal.colour = goalcolour;
		
		this.board = Array(this.size.h).fill(undefined).map(_ => Array(this.size.w).fill(undefined).map(_ => {
			return {
				haswall: Array(4).fill(undefined).map(_ => false)
			};
		}));
		
		this.directions = [
			{x: 0, y: 1},
			{x: 1, y: 0},
			{x: 0, y:-1},
			{x:-1, y: 0},
		];
		
		this.logs = [];
		
		this.walls.forEach(v => {
			if(v.d===0){
				this.board[v.y-1][v.x].haswall[0] = true;
				this.board[v.y][v.x].haswall[2] = true;				
			}
			else{
				this.board[v.y][v.x-1].haswall[1]= true;
				this.board[v.y][v.x].haswall[3] = true;				
			}
		});
		
		rep(this.size.h,(y => {
			this.board[y][0].haswall[3] = this.board[y][this.size.w-1].haswall[1] = true;
		}));
		rep(this.size.w,(x => {
			this.board[0][x].haswall[2] = this.board[this.size.h-1][x].haswall[0] = true;
		}));
	}
	
	clone(){
		const res = new Board();
		res.size = deepcopy(this.size);
		res.walls = deepcopy(this.walls);
		res.robots = deepcopy(this.robots);
		res.goal = deepcopy(this.goal);
		res.logs = [];
		res.board = deepcopy(this.board);
		res.directions = deepcopy(this.directions);
		
		return res;
	}
	
	iscleared(){
		return samep(this.robots[this.goal.colour],this.goal);
	}
	
	isinside(p: Position){
		return 0 <= p.y && p.y < this.size.h && 0 <= p.x && p.x < this.size.w;
	}
		
	move(c: number,d: number){
		let p = this.robots[c];
		let mp = p;
		for(;;){
			const tp = {
				y: p.y + this.directions[d].y,
				x: p.x + this.directions[d].x,
			};

			if(this.board[p.y][p.x].haswall[d] || 
				this.robots.some(q => samep(tp,q)))break;
			p = tp;
		}
		
		this.logs.push({c: c, d: d, from: mp, to: p});
		this.robots[c] = p;
	}
	
	movecommand(cmd: Move[]){
		for(const v of cmd){
			this.move(v.c,v.d);
		}	
	}
}

export const logstringfy = (log: Move[]) => {
	return log.map(v => colournames[v.c]+directionnames[v.d]).join();
};

export const getBoard = async (boardspec: BoardSpec): Promise<[Board, Move[]]> => {
	const data = await rust_proxy.get_data(boardspec);
	let lines = data.split('\n').filter((line) => line);
	lines = lines.slice(lines.length-4,lines.length);

	const board_data = JSON.parse(lines[0].replace(/Pos|WallPos|Board/g,'').replace(/([a-z]+)/g,'"$1"'));
	const goalcolour = parseInt(lines[1]);
	const goalpos = JSON.parse(lines[2].replace(/Pos/g,'').replace(/([a-z]+)/g,'"$1"'));
	const answer = JSON.parse(lines[3].replace(/Move/g,'').replace(/([a-z]+)/g,'"$1"'));

	const bo =  new Board();
	bo.load_board(board_data,goalcolour,goalpos);
	return [bo,answer];
};
