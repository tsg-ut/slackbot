use std::env;
use std::collections::VecDeque;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};

extern crate rand;
use rand::Rng;
use rand::prelude::SliceRandom;

use std::cmp;

extern crate atoi;
use atoi::atoi;

extern crate itertools;
use itertools::Itertools;

use std::rc::Rc;

#[derive(PartialEq,Eq,Debug,Clone)]
struct Pos {
	y: i8,
	x: i8
}

impl Hash for Pos {
	fn hash<H: Hasher>(&self,state: &mut H) {
		self.y.hash(state);
		self.x.hash(state);
	}
}

#[derive(Debug)]
struct WallPos {
	y: i8,
	x: i8,
	d: i8
}

#[derive(Debug)]
struct Board {
	w: usize,
	h: usize,
	walls: Vec<WallPos>,
	haswall: Vec<Vec<Vec<bool>>>,
	robots: Vec<Pos>,
}

const DIRECTIONS: [Pos; 4] = [ 
	(Pos{y: 1,x: 0}),
	(Pos{y: 0,x: 1}),
	(Pos{y: -1,x: 0}),
	(Pos{y: 0,x: -1})
];

impl Board {
	fn good_board(&mut self) -> bool {
		let mut gone = vec![vec![false;self.w];self.h];
		
		fn dfs<'a>(gone: &'a mut Vec<Vec<bool>>,self_: &'a Board,y: usize, x: usize) -> usize {
			//println!("{} {}",y,x);
			if gone[y][x] { return 0; }
			gone[y][x] = true;
			let mut res = 1;
			for i in 0..4 {
				if self_.haswall[y][x][i] {
					continue;
				}
				let ty = (y as i8 + DIRECTIONS[i].y) as usize;
				let tx = (x as i8 + DIRECTIONS[i].x) as usize;
				if ty < self_.h && tx < self_.w {
					res += dfs(gone,self_,ty,tx);
				}
			}
			return res;
		}
		
		let cn = dfs(&mut gone,self,0,0);
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
					if !self.haswall[y][x][i] {
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
	
	fn init(&mut self,wall_num: usize){
		self.haswall = vec![vec![vec![false;4];self.w];self.h];

		//println!("{} {} {} {}",self.board.len(), self.h, self.board[0].len(), self.w);
		for y in 0..self.h {
			self.haswall[y][0][3] = true;
			self.haswall[y][self.w-1][1] = true;
		}

		for x in 0..self.w {
			self.haswall[0][x][2] = true;
			self.haswall[self.h-1][x][0] = true;
		}
		
		let mut rng = rand::thread_rng();		
		for _ in 0..wall_num {
			let mem_haswall = self.haswall.clone();
			let mut add_walls = vec![];
			let cy = rng.gen_range(0,self.h);
			let cx = rng.gen_range(0,self.w);
			{
				let y = cy + rng.gen_range(0,2);
				let x = cx;
				if 0 < y && y < self.h {
					add_walls.push(WallPos{y: y as i8, x: x as i8, d: 0});
					self.haswall[y-1][x][0] = true;
					self.haswall[y][x][2] = true;
				}
			}
			{
				let y = cy;
				let x = cx + rng.gen_range(0,2);
				if 0 < x && x < self.w {
					add_walls.push(WallPos{y: y as i8, x: x as i8, d: 1});
					self.haswall[y][x-1][1] = true;
					self.haswall[y][x][3] = true;
				}
			}
			
			if self.good_board() {
				println!("add walls {:?}",add_walls);
				self.walls.append(&mut add_walls);
			}
			else{
				self.haswall = mem_haswall;
			}
		}
		
		let mut i = 0;
		while i < 4 {
			let tp = Pos{y: rng.gen_range(0,self.h) as i8, x: rng.gen_range(0,self.w) as i8};
			let mut ok = true;
			for j in 0..i {
				ok &= tp != self.robots[j];
			}
			if ok {
				self.robots.push(tp);
				i += 1;
			}
		}
	}	
  pub fn new(board_h: usize,board_w: usize,wall_num: usize) -> Board {
  	let mut res = Board {w: board_w, h: board_h, walls: vec![],haswall: vec![], robots: vec![]};
  	res.init(wall_num);
  	return res;
  }
}

#[derive(Debug,Clone,Copy)]
struct Move{
	c: usize,
	d: usize
}

struct SinglyLinkedListNode{
	v: Move,
	next: Option<Rc<SinglyLinkedListNode>>
}

struct SinglyLinkedList {
	head: Option<Rc<SinglyLinkedListNode>>
}

impl SinglyLinkedList{
	pub fn nil() -> SinglyLinkedList {
		//SinglyLinkedList{node: SinglyLinkedList_data::Nil}
		SinglyLinkedList{head: None}
	}
	fn cons(&self,data: Move) -> SinglyLinkedList {
   	SinglyLinkedList{head: Some(Rc::new(
   		SinglyLinkedListNode {
   			v: data, next: self.head.clone()
   		}
   	))}
	 	//SinglyLinkedList{node: Some(Box::new((self,data)))}
  	//SinglyLinkedList{node: SinglyLinkedList_data::Cons(Box::new(&self.node),data)}
  }
  
  fn to_vec(&self) -> Vec<Move> {
  	let mut res = vec![];
  	let mut head = &self.head;
  	while let Some(ref p) = head {
			res.push(p.v);
			head = &p.next;
  	}
  	return res;
  }
}


struct State<'a> {
	bo: &'a Board,
	robots: Vec<Pos>,
	log: SinglyLinkedList
}


impl<'a> State<'a> {
	pub fn init_state(bo:&'a Board,_log: SinglyLinkedList) -> State<'a> { 
		State{bo: &bo,robots: bo.robots.clone(), log: SinglyLinkedList::nil()}
	}
	
	fn move_to(&self,robot_index: usize, robot_dir: usize) -> State<'a>{
		let dir = &DIRECTIONS[robot_dir];
		let mut p = self.robots[robot_index].clone();
		let mut mind = cmp::max(self.bo.h,self.bo.w) as i8;
		for j in 0..4 {
			if j != robot_index {
				let dx = self.robots[j].x - p.x;
				let dy = self.robots[j].y - p.y;
				if dx.signum() == dir.x.signum() && dy.signum() == dir.y.signum() {
					if dx.signum() == 0 {
						mind = cmp::min(mind,dy.abs()-1);
					}
					else {
						mind = cmp::min(mind,dx.abs()-1);
					}
				}
			}
		}
		//println!("{} {:?} {:?}",mind,p,self.robots);
		
		for _ in 0..mind {
			if self.bo.haswall[p.y as usize][p.x as usize][robot_dir] {
				break;
			}
			p = Pos{y: p.y + dir.y, x: p.x + dir.x};
		}
		
		let tolog = self.log.cons(Move{c: robot_index,d: robot_dir});
		let mut res = State{bo: self.bo,robots: self.robots.clone(),log: tolog};
		res.robots[robot_index] = p;
		res
	}
	
	fn enumerate_states(&self) -> Vec<State<'a>> {
		let mut res = vec![];
		for i in 0..self.robots.len() {
			for j in 0..4 {
				let ts = self.move_to(i,j);
				res.push(ts);
			}
		}
		//println!("add {} {}",self.robots.len() ,res.len());
		return res;
	}
}

impl<'a,'b> PartialEq for State<'a> {
	fn eq(&self,ts:&State) -> bool {
		return self.robots == ts.robots;
	}
}
impl<'a,'b> Eq for State<'a> {}

impl<'a,'b> Hash for State<'a> {
	fn hash<H: Hasher>(&self,state: &mut H) {
		self.robots.hash(state);
	}
}

fn bfs<'a,'b>(target: u8, bo:&'a Board) -> ((usize,Pos),Vec<Move>){
	//let log = &SinglyLinkedList::Nil;
	let log = SinglyLinkedList::nil();
	let init = State::init_state(&bo,log);
	let mut res = init.log.head.clone();
	let mut goal = (0,init.robots[0].clone());
	
	//let mut gone: HashSet<State,BuildHasherDefault<FnvHasher>> = HashSet::new();
	let mut gone: HashSet<State> = HashSet::new();
	
	let mut que = VecDeque::new();
	let mut depth = 0;
	que.push_back(Some(init));
	que.push_back(None);
	
	let mut found : Vec<Vec<Vec<bool>>> = vec![vec![vec![false;bo.robots.len()];bo.w];bo.h];
	let mut found_count = 0;
	
	let mut dnum = 1;
	while !que.is_empty() {
		match que.pop_front() {
			Some(Some(st)) => {
				if !gone.contains(&st) {
					dnum += 1;
					//println!("{:?}",st.robots);
					let mut ok = false;
					for i in 0..st.robots.len() {
						let p = &st.robots[i];
						if !found[p.y as usize][p.x as usize][i] {
							//println!("{} {} {} : {} ",p.y,p.x,i,depth); 
							found[p.y as usize][p.x as usize][i] = true;
							found_count += 1;
							res = st.log.head.clone();
							goal = (i,p.clone());
							if depth >= target || found_count >= bo.h * bo.w * bo.robots.len() {
								ok = true;
								break;
							}
						}
					}
					if ok { break; }
					for ts in st.enumerate_states() {
						if !gone.contains(&ts) {
							//println!("{:?}",ts.robots);
							que.push_back(Some(ts));
						}
					}
					gone.insert(st);
				}
			},
			Some(None) => {
				depth += 1;
				if depth > target {
					break;
				}
				println!("{} {}",depth,dnum);
				dnum = 0;
				que.push_back(None);
			},
			None => {}
		}
	}
	
	//return None;
	let l = SinglyLinkedList{head: res};
	
	return (goal,l.to_vec());
	//return l.to_vec(); //SinglyLinkedList::to_vec(l);
}


fn main(){
	let args: Vec<String> = env::args().collect();
	let (depth,board_h,board_w,wall_num) = match args[1..5].into_iter().map(|x| atoi(x.as_bytes())).tuples().next()  {
		Some((Some(a),Some(b),Some(c),Some(d))) => (a,b,c,d),
		v => panic!("invalid argument. expect \"depth board_h board_w wall_num\", got {:?}.",v)
	};
	
	let mut bo = Board::new(board_h,board_w,wall_num);
	let ((mut goalcolour,goalpos),mut log) = bfs(depth as u8,&bo);
	
	//randomize colour
	let mut rng = rand::thread_rng();
	let mut perm: Vec<usize> = (0..bo.robots.len()).collect();
	perm.shuffle(&mut rng);
	let mut perminv: Vec<usize> = vec![0;perm.len()];
	for i in 0..perm.len() {
		perminv[perm[i]] = i;
	}
	
	goalcolour = perm[goalcolour];
	log = log.into_iter().map(|x| Move{c: perm[x.c],d: x.d}).rev().collect();
	bo.robots = (0..bo.robots.len()).map(|k| bo.robots[perminv[k]].clone()).collect();
	
	println!("{:?}",bo);
	println!("{:?}",goalcolour);
	println!("{:?}",goalpos);
	println!("{:?}",log);
}




