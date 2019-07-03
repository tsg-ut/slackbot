'use strict';

const child_process = require('child_process');
const concatstream = require('concat-stream');
const path = require('path');
const board = require('./board.js');

module.exports.get_data = async (depth) => {
	if(!depth)depth = 20;
	const generator = child_process.spawn(path.join(__dirname,'../target/release/ricochet_robot_problem_generator'), [`${depth}`]);
	const output = await new Promise((resolve) => {
		generator.stdout.pipe(concatstream({encoding: 'buffer'}, (data) => {
			resolve(data);
		}));
	});
	return output.toString();
}
