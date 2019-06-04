use std::{io, fs};
use std::io::BufRead;
use std::iter::FromIterator;
use std::collections::HashMap;
use std::error::Error;
use fst::{IntoStreamer, Streamer, Set};
use rand::thread_rng;
use rand::seq::SliceRandom;

struct Context {
    constraints: Vec<Vec<usize>>,
    set: Set,
    one_gram_counter: HashMap<[u8; 1], usize>,
    two_gram_counter: HashMap<[u8; 2], usize>,
}

fn bytes_to_string(bytes: Vec<u8>) -> String {
    let hiraganas: Vec<char> = "ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわをんー".chars().collect();
    String::from_iter(bytes.iter().map(|&i| hiraganas[(i - 1) as usize]))
}

fn has_prefix(set: &Set, prefix: Vec<u8>) -> bool {
    let mut prefix_stop = prefix.clone();
    *prefix_stop.last_mut().unwrap() += 1;
    set.range().ge(prefix).lt(prefix_stop).into_stream().next() != None
}

fn get_prefix(set: &Set, prefix: Vec<u8>) -> Vec<Vec<u8>> {
    let mut prefix_stop = prefix.clone();
    *prefix_stop.last_mut().unwrap() += 1;
    set.range().ge(prefix).lt(prefix_stop).into_stream().into_bytes()
}

fn count_prefix(set: &Set, prefix: Vec<u8>) -> usize {
    let mut prefix_stop = prefix.clone();
    *prefix_stop.last_mut().unwrap() += 1;
    set.range().ge(prefix).lt(prefix_stop).into_stream().into_bytes().len()
}

fn get_board(context: &Context, board: &mut [u8; 16], index: usize) -> Option<[u8; 16]> {
    let mut vec: Vec<u8> = (1..83).collect();
    let mut rng = thread_rng();
    vec.shuffle(&mut rng);
    board[index] = vec[0];
    if index == 15 {
        Some(*board)
    } else {
        get_board(context, board, index + 1)
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let hiraganas: Vec<char> = "ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわをんー".chars().collect();

    let f = fs::File::open("crossword.txt")?;
    let file = io::BufReader::new(f);

    let mut words: Vec<Vec<u8>> = Vec::new();
    'lines: for line in file.lines() {
        let word = line?;
        let mut indices: Vec<u8> = Vec::new();
        for char in word.chars() {
            match hiraganas.iter().position(|&c| c == char) {
                Some(i) => indices.push((i + 1) as u8),
                None => continue 'lines,
            }
        }
        words.push(indices);
    }

    words.sort();
    let set = Set::from_iter(words)?;

    let mut one_gram_counter: HashMap<[u8; 1], usize> = HashMap::new();
    let mut two_gram_counter: HashMap<[u8; 2], usize> = HashMap::new();

    for i in 0..hiraganas.len() {
        one_gram_counter.insert([i as u8], count_prefix(&set, vec![i as u8]));
        for j in 0..hiraganas.len() {
            two_gram_counter.insert([i as u8, j as u8], count_prefix(&set, vec![i as u8, j as u8]));
        }
    }

    let results: Vec<String> = get_prefix(&set, vec![23, 25])
        .iter()
        .map(|word| bytes_to_string(word.to_vec()))
        .collect();

    println!("{:?}", results);

    let constraints: Vec<Vec<usize>> = vec![
        vec![0, 1, 2, 3],
        vec![4, 5, 6, 7],
        vec![8, 9, 10, 11],
        vec![12, 13, 14, 15],
        vec![0, 5, 10, 15],
        vec![3, 7, 11, 15],
        vec![2, 6, 10, 14],
        vec![1, 5, 9, 13],
        vec![0, 4, 8, 12],
    ];

    let count = get_board(&Context {
        set: set,
        constraints: constraints,
        one_gram_counter: one_gram_counter,
        two_gram_counter: two_gram_counter,
    }, &mut [0; 16], 0);
    println!("{:?}", count);

    Ok(())
}
