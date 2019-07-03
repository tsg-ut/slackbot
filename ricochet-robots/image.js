'use strict';

const sharp = require('sharp');
const cloudinary = require('cloudinary');
const deepcopy = require('deepcopy');


const size = {
	grid: {
		h: 70, w: 70,
	},
	robot: {
		h: 50, w: 50,
	},
	wall: {
		thickness: 5,
	},
	path: {
		thickness: 5,
	},
};

function data2rawsharp(data) {
	return {
		raw: {
			height: size.grid.h * data.h + size.wall.thickness * 2,
			width: size.grid.w * data.w + size.wall.thickness * 2,
			channels: 4
		}
	};
}

const Colour = {
	Red: '#FF0000',
	Green: '#00CC80',
	Blue: '#0000FF',
	Yellow: '#CCCC00',
	Black: '#000000',
	White: '#FFFFFF',
};

const colourset = [
	Colour.Red,
	Colour.Green,
	Colour.Blue,
	Colour.Yellow,
	Colour.Black,
];

const graphics = {
	grid: () => `
		<svg width="70" height="70">
			<rect x="0" y="0" width="70" height="70" fill="#F5F5DB" stroke="#808080" stroke-width="4"/>
		</svg>
	`,
	wall_h: () => `
		<svg width="80" height="10">
			<rect x="0" y="0" width="80" height="10" rx="3" ry="3" fill="#38382D"/>
		</svg>
	`,
	wall_v: () => `
		<svg width="10" height="80">
			<rect x="0" y="0" width="10" height="80" rx="3" ry="3" fill="#38382D"/>
		</svg>
	`,
	robot: ({ colour }) => `
		<svg width="50" height="50">
			<circle cx="25" cy="25" r="25" fill="${colour}" shape-rendering="crispEdges"/>
		</svg>
	`,
	trace: ({ colour }) => `
		<svg width="50" height="50">
			<circle cx="25" cy="25" r="22.5" fill="none" stroke="${colour}" stroke-width="5" shape-rendering="crispEdges"/>
		</svg>
	`,
	goal: ({ colour }) => `
		<svg width="50" height="50" viewBox="0 0 512 512">
			<polygon points="256,12.531 327.047,183.922 512,198.531 370.938,319.047 414.219,499.469 256,402.563 97.781,499.469 141.063,319.047 0,198.531 184.953,183.922" fill="${colour}" shape-rendering="crispEdges"/>
		</svg>
	`,
};

async function data2buffer(data) {

	const rawsharp = data2rawsharp(data);
	let board = sharp({
		create: Object.assign({ background: { r: 0, g: 0, b: 0, alpha: 255 } }, rawsharp.raw)
	});
	
	const composites = [];
	function compose_to_board(src,pos) {
		composites.push({ input: src, left: pos.x, top: pos.y });
	}
	async function flush_board() {
		return await board.composite(composites).toBuffer();
	}
	
	const grid = Buffer.from(graphics.grid());
	for (const y of Array(data.h).keys()) {
		for (const x of Array(data.w).keys()) {
			compose_to_board(grid, {
				y: y * size.grid.h + size.wall.thickness,
				x: x * size.grid.w + size.wall.thickness,
			});
		}
	}
	
	function pos2topleft(p) {
		return {
			y: p.y * size.grid.h + (size.grid.h - size.robot.h) / 2 + size.wall.thickness,
			x: p.x * size.grid.w + (size.grid.w - size.robot.w) / 2 + size.wall.thickness,
		};
	}

	for (const [i, p] of data.robots.entries()) {
		const robot = Buffer.from(graphics.robot({ colour: colourset[i] }));
		compose_to_board(robot, pos2topleft(p));
	}

	{
		let colour;
		if (!data.iscleared()) {
			colour = colourset[data.goal.colour];
		}
		else {
			colour = Colour.White;
		}
		const goal = Buffer.from(graphics.goal({ colour }));
		compose_to_board(goal, pos2topleft(data.goal));
	}

	const wall_h = Buffer.from(graphics.wall_h());
	const wall_v = Buffer.from(graphics.wall_v());
	for (const y of Array(data.h).keys()) {
		compose_to_board(wall_v, {
			y: y * size.grid.h,
			x: 0,
		});
		compose_to_board(wall_v, {
			y: y * size.grid.h,
			x: data.w * size.grid.w,
		});
	}
	for (const x of Array(data.w).keys()) {
		compose_to_board(wall_h, {
			y: 0,
			x: x * size.grid.w,
		});
		compose_to_board(wall_h, {
			y: data.h * size.grid.h,
			x: x * size.grid.w,
		});
	}

	for (const wall of data.walls) {
		let p = {
			y: wall.y * size.grid.h,
			x: wall.x * size.grid.w,
		};

		const wallimg = wall.d === 0 ? wall_h : wall_v;
		compose_to_board(wallimg, p);
	}


	if (data.logs.length > 0) {

		let svgstr = '';

		function pos2cp(p) {
			const dc = -size.path.thickness / 2;
			return {
				y: (p.y + 0.5) * size.grid.h + size.wall.thickness + dc,
				x: (p.x + 0.5) * size.grid.w + size.wall.thickness + dc,
			};
		}

		const robotpos = deepcopy(data.robots);

		for (const v of deepcopy(data.logs).reverse()) {
			const colour = colourset[v.c];

			const tk = size.path.thickness;
			let w, h;
			const p = pos2cp({ y: Math.min(v.from.y, v.to.y), x: Math.min(v.from.x, v.to.x) });
			if (v.from.x === v.to.x) {
				h = Math.abs(v.from.y - v.to.y) * size.grid.h + tk;
				w = tk;
			}
			else {
				h = tk;
				w = Math.abs(v.from.x - v.to.x) * size.grid.w + tk;
			}
			svgstr += `<rect y="${p.y}" x="${p.x}" width="${w}" height="${h}" fill="${colour}"/>`;

			robotpos[v.c] = v.from;
		}
		svgstr = `<svg height="${rawsharp.raw.height}" width="${rawsharp.raw.width}">` + svgstr + '</svg>';
		compose_to_board(Buffer.from(svgstr), { y: 0, x: 0 });

		for (const [i, rp] of robotpos.entries()) {
			const traceimg = Buffer.from(graphics.trace({ colour: colourset[i] }));
			compose_to_board(traceimg, pos2topleft(rp));
		}
	}
	return await flush_board();
};


module.exports.data2dump = async (data, filename) => {
	await sharp(await data2buffer(data), data2rawsharp(data)).toFile(filename);
};


async function uploadbuffer(image) {
	const result = await new Promise((resolve, reject) => {
		cloudinary.v2.uploader.upload_stream({ resource_type: 'image' }, (error, data) => {
			if (error) {
				reject(error);
			} else {
				resolve(data);
			}
		}).end(image);
	});
	return result.secure_url;
}

module.exports.upload = async (data) => {
	let image = await data2buffer(data);
	image = await sharp(image, data2rawsharp(data))
		.jpeg()
		.toBuffer();
	for (const _ of Array(20).fill()) {
		try {
			return await uploadbuffer(image);
		}
		catch (e) {
		}
	}
	return await uploadbuffer(data);
};
