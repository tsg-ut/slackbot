'use strict';

const image = require('./image.js');
const deepcopy = require('deepcopy');

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


function samep(p,q){
	return p.x === q.x && p.y === q.y;
}

module.exports.str2command = (str) => {
	const res = [];
	for (let matchArray, re = /([赤青黄緑])([上下左右]+)/g; (matchArray = re.exec(str));) {
		//console.log(matchArray);
		for(const d of matchArray[2]){
			res.push({
				c: colournames.indexOf(matchArray[1]),
				d: directionnames.indexOf(d),
			});
		}
	}
	return res;
}

class Board{
	constructor(){
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
		
		//console.log(this.walls);
		
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
		
		this.logs = [];
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
		//console.log(v);
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


//最短手数を返す
module.exports.solver = (board) => {
	let moves = undefined;
	const colournum = board.robots.length;
	const initialstate = board.dumpstate();
	const mem = new Set();
	
	const queue = [[0,board.hashstate(),initialstate]];
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

module.exports.logstringfy = (log) => {
	return log.map(v => colournames[v.c]+directionnames[v.d]).join();
};

module.exports.getRandomBoard = () => {
	return new Board();
};









