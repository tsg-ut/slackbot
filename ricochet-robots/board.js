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

module.exports.isMADE = (str) => {
	return str.match(/まで$/);
}

module.exports.str2command = (str) => {
	const res = [];
	for (let matchArray, re = /([赤青黄緑rgby])([上下左右wasdhjkl]+)/g; (matchArray = re.exec(str));) {
		//console.log(matchArray);
		for(const d of matchArray[2]){
			res.push({
				c: colourname2idx[matchArray[1]],
				d: directionname2idx[d],
			});
		}
	}
	//console.log('str2command',str,res);
	return res;
}

function samep(p,q){
	return p.x === q.x && p.y === q.y;
}

class Board{
	constructor(){}
	load_board(data,goalcolour,goalpos){
		this.h = data["h"];
		this.w = data["w"];
		function pos2array(x){
			return x;
		}
		this.walls = data["walls"].map(pos2array);
		this.robots = data["robots"].map(pos2array);
		this.goal = pos2array(goalpos);
		this.goal.colour = goalcolour;
		this.init_board();
	}
	init(){
		this.h = 5;
		this.w = 7;
		this.walls = [];
		
		{
			const mem = Array(this.h).fill().map(_ => Array(this.w).fill());
			rep(this.h,(y => {
				rep(this.w,(x => {
					mem[y][x] = 4;
					if(y === 0 || y === this.h-1)mem[y][x]--;
					if(x === 0 || x === this.w-1)mem[y][x]--;
				}));
			}));
			
			const mcs = [];
			rep(10,(i => {
				const cy = randi(0,this.h);
				const cx = randi(0,this.w);
				const cp = {y: cy, x: cx};
				const nws = [];
				const ps = [];
				{ // -
					const y = cy + randi(0,2);
					const x = cx;
					if(0 < y && y < this.h){
						nws.push({y: y, x: x, d: 0});
 						ps.push({x: x,y: y-1},{x: x,y: y});
 					}
				}
				{ // |
					const y = cy;
					const x = cx + randi(0,2);
					if(0 < x && x < this.w){
						nws.push({y: y, x: x, d: 1});
 						ps.push({x: x-1,y: y},{x: x,y: y});
 					}
				}
				ps.forEach(p => { mem[p.y][p.x] -= 1; });
				if(ps.every(p => mem[p.y][p.x] >= 2) && mcs.every(q => !samep(q,cp))){
					this.walls = this.walls.concat(nws);
					mcs.push(cp);
					//console.log(cp,ps);
				}
				else{
					ps.forEach(p => { mem[p.y][p.x] += 1; });
				}
			}));
			
			//console.log(mem);
		}

		
		this.robots = [];
		rep(5,(_ => {
			for(;;){
				const p = {y: randi(0,this.h), x: randi(0,this.w)};
				if(this.robots.every(q => !samep(p,q))){
					this.robots.push(p);
					break;
				}
			}
		}));
		
		this.goal = this.robots.pop();
		this.goal.colour = randi(0,4);
		
		this.init_board();
	}
		
	init_board(){
		this.board = Array(this.h).fill().map(_ => Array(this.w).fill().map(_ => {
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
		
		rep(this.h,(y => {
			this.board[y][0].haswall[3] = this.board[y][this.w-1].haswall[1] = true;
		}));
		rep(this.w,(x => {
			this.board[0][x].haswall[2] = this.board[this.h-1][x].haswall[0] = true;
		}));
		
		//マップの全マスが連結か確認
		{
			const gone = Array(this.h).fill().map(_ => Array(this.w).fill());
			rep(this.h,(y => {
				rep(this.w,(x => {
					gone[y][x]=false;
				}));
			}));
			const dfs = (p)=>{
				let res = 1;
				gone[p.y][p.x] = true;
				rep(4,(i)=>{
					if(this.board[p.y][p.x].haswall[i])return;
					const tp = {
						y: p.y + this.directions[i].y,
						x: p.x + this.directions[i].x,
					};
					if(this.isinside(tp) && !gone[tp.y][tp.x]){
						res += dfs(tp);
					}
				});
				return res;
			}
			
			if(dfs({y: 0, x: 0}) !== this.h * this.w){
				throw new Error('disconnected board');
			}
		}
	}
	
	iscleared(){
		//console.log(this.robots[this.goal.colour],this.goal,samep(this.robots[this.goal.colour],this.goal));
		return samep(this.robots[this.goal.colour],this.goal);
	}
	
	isinside(p){
		return 0 <= p.y && p.y < this.h && 0 <= p.x && p.x < this.w;
	}
	

	isstuck(c,d){
		const p = this.robots[c];
		const tp = {
			y: p.y + this.directions[d].y,
			x: p.x + this.directions[d].x,
		};
		return this.board[p.y][p.x].haswall[d] || this.robots.some(q => samep(tp,q));
	}
	
	move(c,d){
		let p = this.robots[c];
		let mp = p;
		for(;;){
			const tp = {
				y: p.y + this.directions[d].y,
				x: p.x + this.directions[d].x,
			};
			/*
			console.log(p);
			console.log(this.board[p.y]);
			console.log(this.board[p.y][p.x]);
			*/
			if(this.board[p.y][p.x].haswall[d] || 
				this.robots.some(q => samep(tp,q)))break;
			p = tp;
		}
		
		//console.log(mp,p);
		this.logs.push({c: c, d: d, from: mp, to: p});
		this.robots[c] = p;
	}
	
	movecommand(cmd){
		for(const v of cmd){
			this.move(v.c,v.d);
		}	
	}
	
	undo(){
		const v = this.logs.pop();
		this.robots[v.c] = v.from;
	}

	undocommand(cmd){
		for(const v of cmd){
			this.undo();
		}	
	}
	
	hashstate(){
		return String(this.robots.map(v => [v.y,v.x]));
	}
	
	loadstate(state){
		this.logs = state.logs;
		this.robots = state.robots;
	}
	
	dumpstate(){
		return {
			logs: deepcopy(this.logs),
			robots: deepcopy(this.robots),
		};
	}
}


class Queue{
	constructor(){
		this.hd = undefined;
		this.tl = undefined;
	}
	push(d){
		const node = {
			data: d,
			next: undefined,
		};
		if(!this.hd){
			this.hd = this.tl = node;
			return;
		}
		this.tl.next = node;
		this.tl = node;
	}
	shift(){
		if(!this.hd)return undefined;
		const res = this.hd.data;
		this.hd = this.hd.next;
		return res;
	}
	isempty(){
		return (!this.hd);
	}
}


//最短手数を返す
module.exports.solver = (board) => {
	let moves = undefined;
	const colournum = board.robots.length;
	const initialstate = board.dumpstate();
	const mem = new Set();
	
	const queue = new Queue();
	queue.push([0,board.hashstate(),initialstate]);
	mem.add(board.hashstate());
	
	for(;;){
		//console.log(queue);
		const top = queue.shift();
		const depth = top[0], hash = top[1], state = top[2];
		//console.log(i,depth,hash);
		board.loadstate(state);
		//await image.upload(board,'ds/' + depth + '_' + i + '.png');
		
		if(board.iscleared()){
			moves = board.logs;
			break;
		}
		rep(colournum,(c => {
			rep(4,(dir => {
				if(board.isstuck(c,dir))return;
				board.move(c,dir);
				const hash = board.hashstate();
				if(!mem.has(hash)){
					mem.add(hash);
					queue.push([depth+1,hash,board.dumpstate()]);
				}
				board.undo();
			}));
		}));
	}
	
	//console.log(mem);
	board.loadstate(initialstate);
	return moves;
}



function cp2str(cp){
	//console.log(cp);
	return cp[0] + ',' + cp[1].y + ',' + cp[1].x;
}

function str2cp(str){
	const d = str.split(',').map(v => parseInt(v));
	return [d[0],{
		y: d[1], x: d[2],
	}];
}

//n手かかるゴールから乱択する
module.exports.getlongergoal = (board,sup) => {
	let moves = undefined;
	const colournum = board.robots.length;
	const initialstate = board.dumpstate();
	const mem = new Set();
	const goals = [...board.robots.entries()].map(d => {
		const res = {};
		res[cp2str(d)] = {
			len: 0,
			log: [],
		};
		return res;
	});
	
	const queue = new Queue();
	queue.push([0,board.hashstate(),initialstate]);
	mem.add(board.hashstate());
	
	let memdepth = 0;
	let sn = 1;
	let dgn = 4;
	for(;;){
		if(queue.isempty()){
			break;
		}
		//console.log(queue);
		const top = queue.shift();
		const depth = top[0], hash = top[1], state = top[2];
		if(memdepth<depth){
			//console.log(depth,sn,dgn);
			memdepth = depth;
		}
		//console.log(i,depth,hash);
		board.loadstate(state);
		//await image.upload(board,'ds/' + depth + '_' + i + '.png');
		
		{
			let isbreak = false;
			for(const cp of board.robots.entries()){
				const ps = cp2str(cp);
				if(!(ps in goals)){
					const d = {
						len: depth,
						log: ((!sup || depth >= sup) ? deepcopy(state.logs) : undefined),
					};
					goals[ps] = d;
					dgn += 1;
					if(dgn >= colournum * board.h * board.w){
						isbreak = true;
					}
				}
			}
			if(isbreak)break;	
		}
		
		if(depth>=sup)continue;
		
		rep(colournum,(c => {
			rep(4,(dir => {
				if(board.isstuck(c,dir))return;
				board.move(c,dir);
				const hash = board.hashstate();
				if(!mem.has(hash)){
					mem.add(hash);
					sn += 1;
					queue.push([depth+1,hash,board.dumpstate()]);
				}
				board.undo();
			}));
		}));
	}
	
	//console.log('bfsed');
	sup = memdepth;
	
	//console.log(mem);
	board.loadstate(initialstate);
	
	const goodgoals = Object.entries(goals).filter((d) => d[1].len === sup);
	const goal = goodgoals[Math.floor(Math.random() * goodgoals.length)];
	//console.log(goal);
	if(!goal)return undefined;
	const d = str2cp(goal[0]);
	board.goal = {
		y: d[1].y,
		x: d[1].x,
		colour: d[0],
	};
	
	return goal[1].log;
}

module.exports.logstringfy = (log) => {
	return log.map(v => colournames[v.c]+directionnames[v.d]).join();
};

module.exports.getRandomBoard = () => {
	const res = new Board();
	res.init();
	return res;
};

module.exports.getBoard = async (depth) => {
	const data = await rust_proxy.get_data(depth);
	let lines = data.split('\n').filter((line) => line);
	lines = lines.slice(lines.length-4,lines.length);

	const board_data = JSON.parse(lines[0].replace(/Pos|WallPos|Board/g,'').replace(/([a-z]+)/g,'"$1"'));
	const goalcolour = parseInt(lines[1]);
	const goalpos = JSON.parse(lines[2].replace(/Pos/g,'').replace(/([a-z]+)/g,'"$1"'));
	const answer = JSON.parse(lines[3].replace(/\(/g,'[').replace(/\)/g,']'));

	const bo =  new Board();
	bo.load_board(board_data,goalcolour,goalpos);
	//console.log(answer);
	for(let d of answer){
		bo.move(d[0],d[1]);
	}
	const logs = [...bo.logs];
	//console.log(bo.logs);
	for(let d of answer){
		bo.undo();
	}
	return [bo,logs];
};








