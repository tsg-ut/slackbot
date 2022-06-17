use std::collections::HashMap;
use std::collections::VecDeque;
use std::env;
use std::hash::{Hash, Hasher};

extern crate xorshift;
use xorshift::{Rng, SeedableRng, Xorshift128};
type BoardRng = Xorshift128;

extern crate rand;
use rand::prelude::SliceRandom;

extern crate time;
use time::precise_time_ns;

use std::cmp;

extern crate atoi;
use atoi::atoi;

extern crate itertools;
use itertools::Itertools;

#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub struct Pos {
	y: i8,
	x: i8,
}

#[derive(Debug)]
struct WallPos {
	y: i8,
	x: i8,
	d: i8,
}

const ROBOTS_COUNT: usize = 4;

#[derive(Debug)]
pub struct Board {
	w: usize,
	h: usize,
	walls: Vec<WallPos>,
	walldist: Vec<Vec<[usize; 4]>>,
	robots: [Pos; ROBOTS_COUNT],
}

const DIRECTIONS: [Pos; 4] = [
	Pos { y: 1, x: 0 },
	Pos { y: 0, x: 1 },
	Pos { y: -1, x: 0 },
	Pos { y: 0, x: -1 },
];

impl Board {
	fn good_board(&mut self) -> bool {
		let mut gone = vec![vec![false; self.w]; self.h];

		fn dfs<'a>(gone: &'a mut Vec<Vec<bool>>, self_: &'a Board, y: usize, x: usize) -> usize {
			//println!("{} {}",y,x);
			if gone[y][x] {
				return 0;
			}
			gone[y][x] = true;
			let mut res = 1;
			for i in 0..4 {
				if self_.walldist[y][x][i] <= 0 {
					continue;
				}
				let ty = (y as i8 + DIRECTIONS[i].y) as usize;
				let tx = (x as i8 + DIRECTIONS[i].x) as usize;
				if ty < self_.h && tx < self_.w {
					res += dfs(gone, self_, ty, tx);
				}
			}
			return res;
		}

		let cn = dfs(&mut gone, self, 0, 0);
		//println!("{}",cn);
		if cn != self.h * self.w {
			// all cells aren't connected
			return false;
		}

		//println!("{:?}",self.board);

		for y in 0..self.h {
			for x in 0..self.w {
				let mut d = 0;
				for i in 0..4 {
					if self.walldist[y][x][i] > 0 {
						d += 1;
					}
				}
				//println!("{}",d);
				if d < 2 {
					// This cell is not interesting.
					return false;
				}
			}
		}

		return true;
	}

	fn init(&mut self, mut rng: BoardRng, wall_num: usize) {
		self.walldist = vec![vec![[0; 4]; self.w]; self.h];

		//println!("{} {} {} {}",self.board.len(), self.h, self.board[0].len(), self.w);
		println!("{}", rng.gen_range(0, 1000));
		for y in 0..self.h {
			for x in 0..self.w {
				self.walldist[y][x] = [self.h - 1 - y, self.w - 1 - x, y, x];
			}
		}

		for _ in 0..wall_num {
			let mem_walldist = self.walldist.clone();
			let mut add_walls = vec![];
			let cy = rng.gen_range(0, self.h);
			let cx = rng.gen_range(0, self.w);
			{
				let y = cy + rng.gen_range(0, 2);
				let x = cx;
				if 0 < y && y < self.h {
					add_walls.push(WallPos {
						y: y as i8,
						x: x as i8,
						d: 0,
					});

					for ty in 0..y {
						self.walldist[ty][x][0] = cmp::min(y - 1 - ty, self.walldist[ty][x][0]);
					}
					for ty in y..self.h {
						self.walldist[ty][x][2] = cmp::min(ty - y, self.walldist[ty][x][2]);
					}
				}
			}
			{
				let y = cy;
				let x = cx + rng.gen_range(0, 2);
				if 0 < x && x < self.w {
					add_walls.push(WallPos {
						y: y as i8,
						x: x as i8,
						d: 1,
					});
					for tx in 0..x {
						self.walldist[y][tx][1] = cmp::min(x - 1 - tx, self.walldist[y][tx][1]);
					}
					for tx in x..self.w {
						self.walldist[y][tx][3] = cmp::min(tx - x, self.walldist[y][tx][3]);
					}
				}
			}

			if self.good_board() {
				println!("add walls {:?}", add_walls);
				self.walls.append(&mut add_walls);
			} else {
				self.walldist = mem_walldist;
			}
		}

		let mut i = 0;
		while i < 4 {
			let tp = Pos {
				y: rng.gen_range(0, self.h) as i8,
				x: rng.gen_range(0, self.w) as i8,
			};
			let mut ok = true;
			for j in 0..i {
				ok &= tp != self.robots[j];
			}
			if ok {
				self.robots[i] = tp;
				i += 1;
			}
		}
	}
	pub fn new(board_h: usize, board_w: usize, rng: BoardRng, wall_num: usize) -> Board {
		let mut res = Board {
			w: board_w,
			h: board_h,
			walls: vec![],
			walldist: vec![],
			robots: [Pos { y: 0, x: 0 }; ROBOTS_COUNT],
		};
		res.init(rng, wall_num);
		return res;
	}
}

#[derive(Debug, Clone, Copy)]
pub struct Move {
	c: usize,
	d: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct State {
	robots: [Pos; ROBOTS_COUNT],
}

impl State {
	pub fn init_state(bo: &Board) -> State {
		State {
			robots: bo.robots.clone(),
		}
	}

	fn move_to(&self, board: &Board, robot_index: usize, robot_dir: usize) -> Option<State> {
		let dir = &DIRECTIONS[robot_dir];
		let mut p = self.robots[robot_index];
		let mut mind = board.walldist[p.y as usize][p.x as usize][robot_dir] as i8;
		//removing "as i8" by changing type of walldist doesn't make well difference.

		// if mind == 0 { return None } //pruning with little (0.2~3sec) speedup.
		/*
		if robot_dir == 2 {
			for j in 0..4 {
				if j != robot_index {
					if self.robots[j].x == p.x && self.robots[j].y < p.y {
						mind = cmp::min(mind,p.y - self.robots[j].y - 1);
					}
				}
			}
		} else if robot_dir == 0 {
			for j in 0..4 {
				if j != robot_index {
					if self.robots[j].x == p.x && self.robots[j].y > p.y {
						mind = cmp::min(mind,self.robots[j].y - p.y - 1);
					}
				}
			}
		} else {
			for j in 0..4 {
				if j != robot_index {
					let dx = self.robots[j].x - p.x;
					if dx.signum() == dir.x.signum() && self.robots[j].y == p.y {
						mind = cmp::min(mind,dx.abs()-1);
					}
				}
			}
		}
		//unloling also has little speedup (0.2~0.3 sec)
		*/
		for j in 0..4 {
			if j != robot_index {
				let dx = self.robots[j].x - p.x;
				let dy = self.robots[j].y - p.y;
				if dx.signum() == dir.x.signum() && dy.signum() == dir.y.signum() {
					if dx.signum() == 0 {
						mind = cmp::min(mind, dy.abs() - 1);
					} else {
						mind = cmp::min(mind, dx.abs() - 1);
					}
				}
			}
		}

		if mind == 0 {
			return None;
		}

		p = Pos {
			y: p.y + dir.y * mind,
			x: p.x + dir.x * mind,
		};

		let mut res = State {
			robots: self.robots.clone(),
		};
		res.robots[robot_index] = p;
		Some(res)
	}

	fn enumerate_states(&self, board: &Board) -> Vec<(State, Move)> {
		let mut res = Vec::with_capacity(16);
		for i in 0..self.robots.len() {
			for j in 0..4 {
				if let Some(ts) = self.move_to(board, i, j) {
					res.push((ts, Move { c: i, d: j }));
				}
			}
		}
		return res;
	}
}

impl Hash for State {
	fn hash<H: Hasher>(&self, state: &mut H) {
		//Surprisingly, this makes program very fast!
		//:waiwai:
		let mut bits: u64 = 0;
		for i in 0..ROBOTS_COUNT {
			let p = self.robots[i];
			bits |= (((p.y as u64) << 8) | (p.x as u64)) << (i * 16);
		}
		bits.hash(state);
	}
}

/**
 * its internal representation is like below:
 *
 * 	                0b_0000_00000000_00000000
 *     robot_index     ^^
 *       robot_dir       ^^
 *          prev_y          ^^^^^^^^
 *          prev_x                   ^^^^^^^^
 *
 * making the data compact increases speed a little. (ura)
 */
struct Prev(u64);

impl Prev {
	fn serialize(m: &Move, p: &Pos) -> Self {
		let prev = ((m.c as u64) << 18) | ((m.d as u64) << 16) | ((p.y as u64) << 8) | (p.x as u64);
		Prev(prev)
	}

	fn deserialize(&self) -> (Move, Pos) {
		let robot_index = (self.0 >> 18) as usize;
		let robot_dir = ((self.0 >> 16) & 0b11) as usize;
		let prev_y = ((self.0 >> 8) & 0xff) as i8;
		let prev_x = (self.0 & 0xff) as i8;
		(
			Move {
				c: robot_index,
				d: robot_dir,
			},
			Pos {
				y: prev_y,
				x: prev_x,
			},
		)
	}
}

pub fn bfs<'a, 'b>(target: u8, bo: &'a Board) -> ((usize, Pos), Vec<Move>) {
	let init = State::init_state(&bo);
	let mut goal = (0, init.robots[0]);

	let mut prev: HashMap<State, Option<Prev>> = HashMap::new();

	let mut que = VecDeque::new();
	let mut depth = 0;
	que.push_back(Some(init));
	que.push_back(None);

	let mut found = vec![vec![[false; ROBOTS_COUNT]; bo.w]; bo.h];
	let mut found_count = 0;
	let max_pattern_num = bo.h * bo.w * bo.robots.len();

	let mut last_state = init;

	prev.insert(init, None);

	let mut dnum = 1;
	while let Some(st) = que.pop_front() {
		match st {
			Some(st) => {
				last_state = st;
				dnum += 1;
				//println!("{:?}",st.robots);
				let mut ok = false;
				for i in 0..st.robots.len() {
					let p = st.robots[i];
					if !found[p.y as usize][p.x as usize][i] {
						//println!("{} {} {} : {} ",p.y,p.x,i,depth);
						found[p.y as usize][p.x as usize][i] = true;
						found_count += 1;
						goal = (i, p);
						if depth >= target || found_count >= max_pattern_num {
							ok = true;
							break;
						}
					}
				}
				if ok {
					break;
				}
				for (ts, m) in st.enumerate_states(&bo) {
					// kcz-san and satos-san say that performing `push_back` here
					// decreases speed, but this is necessary for path reconstruction.
					// However, using `entry` instead of `contains_key` and `insert`
					// increases speed a bit. (ura)
					prev.entry(ts).or_insert_with(|| {
						que.push_back(Some(ts));
						let p = st.robots[m.c];
						Some(Prev::serialize(&m, &p))
					});
				}
			}
			None => {
				depth += 1;
				if depth > target {
					break;
				}
				println!("{} {}", depth, dnum);
				dnum = 0;
				que.push_back(None);
			}
		}
	}

	// path reconstruction
	let mut l = vec![];
	let mut s = last_state;
	while let Some(prev) = &prev[&s] {
		let (m, p) = prev.deserialize();
		l.push(m);
		s.robots[m.c] = p;
	}

	return (goal, l);
}

fn main() {
	let args: Vec<String> = env::args().collect();
	let (depth, board_h, board_w, wall_num) = match args[1..5]
		.into_iter()
		.map(|x| atoi(x.as_bytes()))
		.tuples()
		.next()
	{
		Some((Some(a), Some(b), Some(c), Some(d))) => (a, b, c, d),
		v => panic!(
			"invalid argument. expect \"depth board_h board_w wall_num\", got {:?}.",
			v
		),
	};

	let now = precise_time_ns();
	let states = [now, now];
	let stdrng = SeedableRng::from_seed(&states[..]);
	let mut bo = Board::new(board_h, board_w, stdrng, wall_num);
	let ((mut goalcolour, goalpos), mut log) = bfs(depth as u8, &bo);

	//randomize colour
	let mut rng = rand::thread_rng();
	let mut perm: Vec<usize> = (0..bo.robots.len()).collect();
	perm.shuffle(&mut rng);
	let mut perminv: Vec<usize> = vec![0; perm.len()];
	for i in 0..perm.len() {
		perminv[perm[i]] = i;
	}

	goalcolour = perm[goalcolour];
	log = log
		.into_iter()
		.map(|x| Move {
			c: perm[x.c],
			d: x.d,
		})
		.rev()
		.collect();

	{
		let copy = bo.robots;
		for i in 0..ROBOTS_COUNT {
			bo.robots[i] = copy[perminv[i]];
		}
	}

	println!("{:?}", bo);
	println!("{:?}", goalcolour);
	println!("{:?}", goalpos);
	println!("{:?}", log);
}
