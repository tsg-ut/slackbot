'use strict';

import child_process from 'child_process';
import concatstream from 'concat-stream';
import path from 'path';

interface BoardSpec {
	depth: number,
	size: {h: number, w: number},
	numOfWalls: number,
}

export const get_data = async (boardspec: BoardSpec) => {
	const generator = child_process.spawn(
											path.join(__dirname,'../target/release/ricochet_robot_problem_generator'), 
											[`${boardspec.depth}`,`${boardspec.size.h}`,`${boardspec.size.w}`,`${boardspec.numOfWalls}`]);
	const output = await new Promise((resolve) => {
		const stream = concatstream({ encoding: 'buffer' }, (data) => {
			resolve(data);
		});
		generator.stdout.pipe(stream as any);
	});
	return output.toString();
};
