'use strict';

const child_process = require('child_process');
const concatstream = require('concat-stream');
const path = require('path');
const board = require('./board.js');

module.exports.get_data = async (depth) => {
	if(!depth)depth = 20;
	const generator = child_process.spawn(`target/release/main`, [`${depth}`]);
	//console.log(generator);
	//console.log(concatstream,concatstream.concat);
	const output = await new Promise((resolve) => {
		generator.stdout.pipe(concatstream({encoding: 'buffer'}, (data) => {
			resolve(data);
		}));
	});
	return output.toString();
}
