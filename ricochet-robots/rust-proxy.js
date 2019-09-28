'use strict';

const child_process = require('child_process');
const concatstream = require('concat-stream');
const path = require('path');
const board = require('./board.js');

module.exports.get_data = async (boardspec) => {
	const generator = child_process.spawn(
											path.join(__dirname,'../target/release/ricochet_robot_problem_generator'), 
											[`${boardspec.depth}`,`${boardspec.size.h}`,`${boardspec.size.w}`,`${boardspec.numOfWalls}`]);
	const output = await new Promise((resolve) => {
		generator.stdout.pipe(concatstream({encoding: 'buffer'}, (data) => {
			resolve(data);
		}));
	});
	return output.toString();
}
