use std::fs;

extern crate xorshift;
use xorshift::{Rng,SeedableRng, Xorshift128};

use std::time::Instant;

#[allow(dead_code)]
mod main;

fn main() -> Result<(), Box<dyn std::error::Error + 'static>>{
	let board_h = 5;
	let board_w = 7;
	let wall_num = 10;
	let num_of_problem = 10;
	
	let mut bos = vec![];
	for t in 0..num_of_problem {
		let seed = [t+1,t+1];
		let mut rng = Xorshift128::from_seed(&seed);
		for _ in 1..200 {
			let _ : u64 = rng.gen();
		}
		println!("generate");
		bos.push(main::Board::new(board_h,board_w,rng,wall_num));
	}
	
	let result = format!("{:?}##{:?}",bos[0],main::bfs(100,&bos[0]));
	let expect = fs::read_to_string("./bench_correctness_check.txt")?;
	assert_eq!(expect,result);
	
	let start = Instant::now();
  for bo in &bos[1..] {
  	main::bfs(100,&bo);
  }
	let end = start.elapsed();
	
	println!("{}.{:03}s", end.as_secs(), end.subsec_nanos() / 1_000_000);
	Ok(())
}

//0.84sec

