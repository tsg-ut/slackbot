'use strict';

const childprocess = require('child_process');
const concatstream = require('concat-stream');
const board = require('./board.js');

async function get_data(depth){
	if(!depth)depth = 20;
	
	const generator = childprocess.spawn(`target/release/main`, [`${depth}`]);
	console.log(concatstream,concatstream.concat);
	const output = await new Promise((resolve) => {
		generator.stdout.pipe(concatstream({encoding: 'buffer'}, (data) => {
			resolve(data);
		}));
	});
	const lines = output.toString().split('\n').filter((line) => line);
	console.log(lines);
	const [board,goalcolour,goalpos,answer] = lines.slice(lines.length-4,lines.length);
	console.log(lines.slice(lines.length-4,lines.length),board," ",board.replace(/Pos/g,'').replace(/Board/g,'').replace(/([a-z]+)/g,'"$1"'));
	return [
		JSON.parse(board.replace(/Pos|WallPos|Board/g,'').replace(/([a-z]+)/g,'"$1"')),
		parseInt(goalcolour),
		JSON.parse(goalpos.replace(/Pos/g,'').replace(/([a-z]+)/g,'"$1"')),
		JSON.parse(answer.replace(/\(/g,'[').replace(/\)/g,']')),
	];
}

module.exports.getBoard = async (depth) => {
	const [board_data,goalcolour,goalpos,answer] = await get_data(depth);
	const bo = board.getBoard();
	bo.load_board(board_data,goalcolour,goalpos);
	console.log(answer);
	for(let d of answer){
		bo.move(d[0],d[1]);
	}
	const logs = [...bo.logs];
	console.log(bo.logs);
	for(let d of answer){
		bo.undo();
	}
	return [bo,logs];
};

