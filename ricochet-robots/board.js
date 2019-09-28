'use strict';

const image = require('./image.js');
const deepcopy = require('deepcopy');
const rust_proxy = require('./rust-proxy.js');

function rep(n,f){ for(let i = 0; i < n; i++)f(i); } 

function randi(a,b){
	return Math.floor(Math.random() * (b-a) + a);
}

const colournames = [
	'赤','緑','青','黄','黒'
];

const directionnames = [
	'下','右','上','左'
];

function arrays2idxs(arrs){
	let res = {};
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

module.exports.iscommand = (str) => {
	return str.match(/^([赤青黄緑rgby]([上下左右wasdhjkl]+))+(まで)?$/);
}

module.exports.str2command = (str) => {
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

function samep(p,q){
	return p.x === q.x && p.y === q.y;
}

class Board{
	constructor(){}
	load_board(data,goalcolour,goalpos){
		this.size = {
			h: data["h"],
			w: data["w"],
		};
		function pos2array(x){
			return x;
		}
		this.walls = data["walls"].map(pos2array);
		this.robots = data["robots"].map(pos2array);
		this.goal = pos2array(goalpos);
		this.goal.colour = goalcolour;
		
		this.board = Array(this.size.h).fill().map(_ => Array(this.size.w).fill().map(_ => {
			return {
				haswall: Array(4).fill().map(_ => false)
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
	
	isinside(p){
		return 0 <= p.y && p.y < this.size.h && 0 <= p.x && p.x < this.size.w;
	}
		
	move(c,d){
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
	
	movecommand(cmd){
		for(const v of cmd){
			this.move(v.c,v.d);
		}	
	}
}

module.exports.logstringfy = (log) => {
	return log.map(v => colournames[v.c]+directionnames[v.d]).join();
};

module.exports.getBoard = async (boardspec) => {
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








