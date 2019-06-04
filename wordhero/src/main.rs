#[macro_use]
extern crate lazy_static;

use std::{io, fs};
use std::io::BufRead;
use std::iter::FromIterator;
use std::collections::HashMap;
use std::error::Error;
use fst::{IntoStreamer, Streamer, Set};
use rand::thread_rng;
use rand::seq::SliceRandom;

const HIRAGANAS: [char; 81] = ['ぁ', 'あ', 'ぃ', 'い', 'ぅ', 'う', 'ぇ', 'え', 'ぉ', 'お', 'か', 'が', 'き', 'ぎ', 'く', 'ぐ', 'け', 'げ', 'こ', 'ご', 'さ', 'ざ', 'し', 'じ', 'す', 'ず', 'せ', 'ぜ', 'そ', 'ぞ', 'た', 'だ', 'ち', 'ぢ', 'っ', 'つ', 'づ', 'て', 'で', 'と', 'ど', 'な', 'に', 'ぬ', 'ね', 'の', 'は', 'ば', 'ぱ', 'ひ', 'び', 'ぴ', 'ふ', 'ぶ', 'ぷ', 'へ', 'べ', 'ぺ', 'ほ', 'ぼ', 'ぽ', 'ま', 'み', 'む', 'め', 'も', 'ゃ', 'や', 'ゅ', 'ゆ', 'ょ', 'よ', 'ら', 'り', 'る', 'れ', 'ろ', 'わ', 'を', 'ん', 'ー'];
lazy_static! {
    static ref NON_INITIALS: Vec<u8> = {
        (0..HIRAGANAS.len()).filter_map(|index| {
            if "ぁぃぅぇぉっゃゅょぢづーをん".contains(HIRAGANAS[index]) {
                Some(index as u8 + 1)
            } else {
                None
            }
        }).collect()
    };
}

struct Context {
    constraints: Vec<Vec<usize>>,
    set: Set,
    one_gram_counter: HashMap<[u8; 1], usize>,
    two_gram_counter: HashMap<[u8; 2], usize>,
}

fn is_non_initial(c: u8) -> bool {
    (*NON_INITIALS).contains(&c)
}

fn bytes_to_string(bytes: Vec<u8>) -> String {
    String::from_iter(bytes.iter().map(|&i| {
        if i == 0 {
            '　'
        } else {
            HIRAGANAS[(i - 1) as usize]
        }
    }))
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

fn get_board(context: &Context, board: [u8; 16]) -> Option<[u8; 16]> {
    let mut new_values: Vec<u8> = (1..(HIRAGANAS.len() as u8 + 1)).collect();
    let mut rng = thread_rng();
    new_values.shuffle(&mut rng);
    if board.iter().all(|&c| c != 0) {
        return Some(board);
    }

    let index = board.iter().enumerate().min_by_key(|(i, &c)| {
        if c != 0 {
            return std::u8::MAX;
        }
        let x = *i as u8 % 4;
        let y = *i as u8 / 4;
        return x + y;
    }).unwrap().0;

    'values: for new_value in new_values {
        if is_non_initial(new_value) {
            continue;
        }

        let mut cloned_board = board.clone();
        cloned_board[index] = new_value;

        // check if constraints are met
        for constraint in context.constraints.iter() {
            let prefix: Vec<u8> = constraint.iter().map(|&c| board[c]).take_while(|&c| c != 0).collect();
            if prefix.len() == 0 {
                continue;
            }
            if !has_prefix(&context.set, prefix) {
                continue 'values;
            }
        }

        let result = get_board(context, cloned_board);
        if let Some(board) = result {
            return Some(board);
        }
    }
    None
}

fn main() -> Result<(), Box<dyn Error>> {
    let f = fs::File::open("crossword.txt")?;
    let file = io::BufReader::new(f);

    let mut words: Vec<Vec<u8>> = Vec::new();
    'lines: for line in file.lines() {
        let word = line?;
        let mut indices: Vec<u8> = Vec::new();
        for char in word.chars() {
            match HIRAGANAS.iter().position(|&c| c == char) {
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

    for i in 0..HIRAGANAS.len() {
        one_gram_counter.insert([i as u8], count_prefix(&set, vec![i as u8]));
        for j in 0..HIRAGANAS.len() {
            two_gram_counter.insert([i as u8, j as u8], count_prefix(&set, vec![i as u8, j as u8]));
        }
    }

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

    let board = get_board(&Context {
        set: set,
        constraints: constraints,
        one_gram_counter: one_gram_counter,
        two_gram_counter: two_gram_counter,
    }, [0; 16]);
    if let Some(board) = board {
        println!("{:?}", bytes_to_string(board.to_vec()));
    }

    Ok(())
}
