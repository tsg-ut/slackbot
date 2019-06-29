'use strict';

const sharp = require('sharp');
const path = require('path');
const cloudinary = require('cloudinary');
const deepcopy = require('deepcopy');

function rep(n,f){ for(let i = 0; i < n; i++)f(i); } 


const size = {
	grid: {
		h: 70, w: 70,
	},
	robot: {
		h: 50, w: 50,
	},
	wall: {
		tick: 5,
	},
	path: {
		tick: 5,
	},
};

function data2rawsharp(data){
	return { 
		raw: {
		  height: size.grid.h * data.h + size.wall.tick * 2,
		  width: size.grid.w * data.w + size.wall.tick * 2,
			channels: 4
		}
	};
}

// const colournames = [
// 		'red','green','blue','yellow','black'
// ];

// const colourcodes = [
// 	{r: 255, g: 0, b: 0},
// 	{r: 0, g: 255, b: 0},
// 	{r: 0, g: 0, b: 255},
// 	{r: 204, g: 204, b: 0},
// 	{r: 0, g: 0, b: 0},	
// ];

const Colour = {
	Red:    '#FF7CBC',
	Green:  '#4BC584',
	Blue:   '#409EDA',
	Yellow: '#FADA81',
	Black:  '#000000',
	White:  '#FFFFFF',
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
			<rect x="0" y="0" width="70" height="70" fill="#F5F5DC" stroke="#808080" stroke-width="4"/>
		</svg>
	`,
	wall_h: () => `
		<svg width="80" height="10">
			<rect x="0" y="0" width="80" height="10" fill="#000000"/>
		</svg>
	`,
	wall_v: () => `
		<svg width="10" height="80">
			<rect x="0" y="0" width="10" height="80" fill="#000000"/>
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
}

async function data2buffer(data){
	
	const rawsharp = data2rawsharp(data);

	async function composite(dst,src,pos){
		//console.log(pos);
		return await sharp(dst,rawsharp)
			.overlayWith(src, {left: pos.x, top: pos.y})
			.toBuffer();
	}
	
	let board = await sharp({
		create: Object.assign({background: { r: 0, g: 0, b: 0, alpha: 255}}, rawsharp.raw)
	}).toBuffer();

	// const grid = await sharp(path.resolve(__dirname, 'images', 'grid.png')).toBuffer();
	const grid = await sharp(Buffer.from(graphics.grid())).toBuffer();
	for(const y of [...Array(data.h).keys()]){
		for(const x of [...Array(data.w).keys()]){
			board = await composite(board,grid,{
				y: y*size.grid.h + size.wall.tick,
				x: x*size.grid.w + size.wall.tick,
			});
		}
	}
	//.overlayWith(grid, {gravity: sharp.gravity.northwest, tile: true }).
	
	//console.log(board);
	//const yel = await sharp(path.resolve(__dirname, 'images', colournames[3] + '_robot.png')).toBuffer();
	//board = await composite(board,yel,{ y: 50, x: 50});
	
	function pos2topleft(p){
		return {
			y: p.y * size.grid.h + (size.grid.h - size.robot.h) / 2 + size.wall.tick, 
			x: p.x * size.grid.w + (size.grid.w - size.robot.w) / 2 + size.wall.tick, 
		};
	}
	
	for(const [i,p] of data.robots.entries()){
		// const robot = await sharp(path.resolve(__dirname, 'images', colournames[i] + '_robot.png')).toBuffer();
		const robot = await sharp(Buffer.from(graphics.robot({ colour: colourset[i] }))).toBuffer();
		//console.log(i,p);
		
		board = await composite(board,robot,pos2topleft(p));
	}
	
	{
		let goal;
		if(!data.iscleared()){
			// goal = await sharp(path.resolve(__dirname, 'images', colournames[data.goal.colour] + '_goal.png')).toBuffer();
			goal = await sharp(Buffer.from(graphics.goal({ colour: colourset[data.goal.colour] }))).toBuffer();
		}
		else{
			// goal = await sharp(path.resolve(__dirname, 'images', 'white_goal.png')).toBuffer();
			goal = await sharp(Buffer.from(graphics.goal({ colour: Colour.White }))).toBuffer();
		}
		
		board = await composite(board,goal,pos2topleft(data.goal));
	}
	
	//console.log(data);

	const wall_h = await sharp(Buffer.from(graphics.wall_h())).toBuffer();
	const wall_v = await sharp(Buffer.from(graphics.wall_v())).toBuffer();
	for (const y of [...Array(data.h).keys()]) {
		board = await composite(board, wall_v, {
			y: y * size.grid.h,
			x: 0,
		});
		board = await composite(board, wall_v, {
			y: y * size.grid.h,
			x: data.w * size.grid.w,
		});
	}
	for (const x of [...Array(data.w).keys()]) {
		board = await composite(board, wall_h, {
			y: 0,
			x: x * size.grid.w,
		});
		board = await composite(board, wall_h, {
			y: data.h * size.grid.h,
			x: x * size.grid.w,
		});
	}

	for(const wall of data.walls){
		let p = {
			y: wall.y * size.grid.h,
			x: wall.x * size.grid.w,
		};
		
		// const wallimg = await sharp(path.resolve(__dirname, 'images', 'wall_' + 'hv'[wall.d] + '.png')).toBuffer();
		const wallimg = wall.d === 0 ? wall_h : wall_v;
		board = await composite(board,wallimg,p);
	}
	
	
	if(data.logs.length > 0){
		
	/*
		let svgstr = '\
  	<rect y="20" x="20" width="100" height="100" fill="rgb(0,255,0)"/>\
  	<rect y="20" x="60" width="100" height="100" fill="rgb(255,255,0)"/>\
  	</svg>';
  */
  	let svgstr = "";
  	
  	function pos2cp(p,c){
  		const dc = -size.path.tick/2; // (size.path.tick/2 * (c - data.robots.length/2));
  		return {
  			y: (p.y + 0.5) * size.grid.h + size.wall.tick + dc,
  			x: (p.x + 0.5) * size.grid.w + size.wall.tick + dc,
  		};
  	}
  	
  	const robotpos = deepcopy(data.robots);
  	
		for(const v of deepcopy(data.logs).reverse()){
			const colour = colourset[v.c];
  		
  		const tk = size.path.tick;
  		let w,h;
  		const p = pos2cp({y: Math.min(v.from.y,v.to.y), x: Math.min(v.from.x,v.to.x)},v.c);
  		if(v.from.x === v.to.x){
  			h = Math.abs(v.from.y-v.to.y) * size.grid.h + tk;
  			w = tk; 
  		}
  		else{
  			h = tk; 
   			w = Math.abs(v.from.x-v.to.x) * size.grid.w + tk; 
	 		}
	 		//console.log(v.c,h,w);
  		svgstr += `<rect y="${p.y}" x="${p.x}" width="${w}" height="${h}" fill="${colour}"/>`;
  		
  		robotpos[v.c] = v.from;
  	}
  	//svgstr = '<rect y="175" x="105" width="5" height="140" fill="rgb(255,0,0)"/><rect y="35" x="245" width="70" height="5" fill="rgb(0,255,0)"/><rect y="245" x="35" width="5" height="70" fill="rgb(0,0,255)"/><rect y="35" x="35" width="140" height="5" fill="rgb(204,204,0)"/><rect y="315" x="35" width="420" height="5" fill="rgb(0,0,255)"/>';
		//svgstr = '<rect y="10" x="30" width="70" height="70" fill="rgb(0,255,0)"/>';
		//svgstr = '<rect y="100" x="100" width="150" height="150" fill="rgb(0,255,0)"/>';
		svgstr =  `<svg height="${rawsharp.raw.height}" width="${rawsharp.raw.width}">` + svgstr + '</svg>';
  	//console.log(svgstr);
		board = await composite(board,Buffer.from(svgstr),{y: 0, x: 0});
		
		for(const [i,rp] of robotpos.entries()){
			// const traceimg = await sharp(path.resolve(__dirname, 'images', colournames[i] + '_trace.png')).toBuffer();
			const traceimg = await sharp(Buffer.from(graphics.trace({ colour: colourset[i] }))).toBuffer();
			board = await composite(board,traceimg,pos2topleft(rp));
		}
	}
	return board;
};


module.exports.data2dump = async (data,filename) => {
  await sharp(await data2buffer(data),data2rawsharp(data)).toFile(filename);
};


async function uploadbuffer(image){
	const result = await new Promise((resolve, reject) => {
		cloudinary.v2.uploader.upload_stream({resource_type: 'image'}, (error, data) => {
			//if(!error && Math.random() > 0.5)error = "randerror";
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
	for(const _ of Array(20).fill()){
		try{
			return await uploadbuffer(image);
		}
		catch(e){
			//console.log('upload failed',e);
		}
	}
	return await uploadbuffer(data);
};







