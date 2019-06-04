#[macro_use]
extern crate lazy_static;

use std::{io, fs};
use std::io::BufRead;
use std::iter::FromIterator;
use std::collections::{HashMap, HashSet};
use std::error::Error;
use fst::{IntoStreamer, Streamer, Set};
use rand::thread_rng;
use rand::Rng;
use rand::seq::SliceRandom;
use serde_derive::{Deserialize};
use serde_json;
use serde_repr::Deserialize_repr;

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

#[derive(PartialEq, Deserialize_repr, Debug, Clone)]
#[repr(u8)]
enum Direction {
    Horizontal = 0,
    Diagonal = 1,
    Vertical = 2,
}

#[derive(Deserialize, Debug, Clone)]
struct Constraint {
    direction: Direction,
    cells: Vec<usize>,
}

struct Context<'a> {
    constraints: Vec<Constraint>,
    sets: &'a Vec<Set>,
    cells: HashSet<usize>,
    two_gram_counters: &'a Vec<HashMap<[u8; 2], usize>>,
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

fn get_board(context: &Context, board: [u8; 36]) -> Option<[u8; 36]> {
    if context.cells.iter().all(|&c| board[c] != 0) {
        return Some(board);
    }

    let mut rng = thread_rng();

    let vertical_constraints = context.constraints.iter().filter(|&c| c.direction == Direction::Vertical).collect::<Vec<&Constraint>>();
    let horizontal_constraints = context.constraints.iter().filter(|&c| c.direction == Direction::Horizontal).collect::<Vec<&Constraint>>();

    let max_len = vertical_constraints.len().max(horizontal_constraints.len());

    let vertical_prefixes = vertical_constraints.iter().map(|c| {
        Some((c.cells.iter().map(|&c| board[c]).take_while(|&c| c != 0).collect::<Vec<u8>>(), c))
    }).chain(std::iter::repeat(None)).take(max_len);
    let horizontal_prefixes = horizontal_constraints.iter().map(|c| {
        Some((c.cells.iter().map(|&c| board[c]).take_while(|&c| c != 0).collect::<Vec<u8>>(), c))
    }).chain(std::iter::repeat(None)).take(max_len);

    for (index, (vertical_prefix, horizontal_prefix)) in vertical_prefixes.zip(horizontal_prefixes).enumerate() {
        let mut constraints = Vec::new();
        if let Some(vertical_constraint) = vertical_prefix {
            constraints.push(vertical_constraint);
        }
        if let Some(horizontal_constraint) = horizontal_prefix {
            constraints.push(horizontal_constraint);
        }

        let (prefix, constraint) = constraints.iter().min_by_key(|(c, _)| c.len()).unwrap();

        if prefix.len() == constraint.cells.len() {
            continue;
        }

        if index == 0 && prefix.len() == 0 {
            let mut new_values: Vec<u8> = (1..(HIRAGANAS.len() as u8 + 1)).collect();
            new_values.shuffle(&mut rng);
            'values: for new_value in new_values {
                if is_non_initial(new_value) {
                    continue;
                }

                let mut cloned_board = board.clone();
                cloned_board[constraint.cells[0]] = new_value;

                // no need to check constraints

                let result = get_board(context, cloned_board);
                if let Some(board) = result {
                    return Some(board);
                }
            }

            return None;
        }

        if index == 0 && prefix.len() == 1 {
            let mut new_values: Vec<u8> = (1..(HIRAGANAS.len() as u8 + 1)).collect();
            new_values.shuffle(&mut rng);
            for new_value in new_values {
                if is_non_initial(new_value) {
                    continue;
                }

                if let Some(&count) = context.two_gram_counters[constraint.cells.len() - 3].get(&[prefix[0], new_value]) {
                    if count < 1 {
                        continue;
                    }
                }

                let mut cloned_board = board.clone();
                cloned_board[constraint.cells[1]] = new_value;

                // no need to check constraints

                let result = get_board(context, cloned_board);
                if let Some(board) = result {
                    return Some(board);
                }
            }
            break;
        }

        if index == 1 && prefix.len() == 1 {
            let mut new_values: Vec<u8> = (1..(HIRAGANAS.len() as u8 + 1)).collect();
            new_values.shuffle(&mut rng);
            'second_values: for new_value in new_values {
                let mut cloned_board = board.clone();
                cloned_board[constraint.cells[1]] = new_value;

                // check if constraints are met
                for constraint in context.constraints.iter() {
                    if is_non_initial(cloned_board[constraint.cells[0]]) {
                        continue 'second_values;
                    }
                    let prefix: Vec<u8> = constraint.cells.iter().map(|&c| cloned_board[c]).take_while(|&c| c != 0).collect();
                    if prefix.len() == 0 {
                        continue;
                    }
                    if !has_prefix(&context.sets[constraint.cells.len() - 3], prefix) {
                        continue 'second_values;
                    }
                }

                let result = get_board(context, cloned_board);
                if let Some(board) = result {
                    return Some(board);
                }
            }
            break;
        }

        let mut words = get_prefix(&context.sets[constraint.cells.len() - 3], prefix.to_vec());
        words.shuffle(&mut rng);
        'words: for word in words {
            if index == 0 {
                if word.iter().any(|&c| is_non_initial(c)) {
                    continue;
                }
            }

            let mut cloned_board = board.clone();
            for (&cell, &letter) in constraint.cells.iter().zip(word.iter()) {
                cloned_board[cell] = letter;
            }

            // check if constraints are met
            for constraint in context.constraints.iter() {
                if is_non_initial(cloned_board[constraint.cells[0]]) {
                    continue 'words;
                }
                let prefix: Vec<u8> = constraint.cells.iter().map(|&c| cloned_board[c]).take_while(|&c| c != 0).collect();
                if prefix.len() == 0 {
                    continue;
                }
                if !has_prefix(&context.sets[constraint.cells.len() - 3], prefix) {
                    continue 'words;
                }
            }

            let result = get_board(context, cloned_board);
            if let Some(board) = result {
                return Some(board);
            }
        }

        break;
    }

    None
}

fn main() -> Result<(), Box<dyn Error>> {
    let board_configs: Vec<Vec<Constraint>> = serde_json::from_str(include_str!("../boards.json"))?;

    let f = fs::File::open("crossword.txt")?;
    let file = io::BufReader::new(f);

    let mut word_lists: [Vec<Vec<u8>>; 4] = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
    'lines: for line in file.lines() {
        let word = line?;
        let mut indices: Vec<u8> = Vec::new();
        for char in word.chars() {
            match HIRAGANAS.iter().position(|&c| c == char) {
                Some(i) => indices.push((i + 1) as u8),
                None => continue 'lines,
            }
        }
        word_lists[indices.len() - 3].push(indices);
    }

    let sets = word_lists.iter_mut().map(|word_list| {
        word_list.sort();
        Set::from_iter(word_list).unwrap()
    }).collect::<Vec<Set>>();

    let mut two_gram_counters = vec![
        HashMap::new(),
        HashMap::new(),
        HashMap::new(),
        HashMap::new(),
    ];

    for i in 0..HIRAGANAS.len() {
        for j in 0..HIRAGANAS.len() {
            for (two_gram_counter, set) in two_gram_counters.iter_mut().zip(sets.iter()) {
                two_gram_counter.insert([i as u8, j as u8], count_prefix(&set, vec![i as u8, j as u8]));
            }
        }
    }

    let mut rng = thread_rng();

    for _i in 0..10 {
        let config_index = rng.gen_range(0, board_configs.len());
        let constraints = &board_configs[config_index];
        let cells: HashSet<usize> = constraints.iter().map(|c| c.cells.clone()).flatten().collect();
        let context = Context {
            sets: &sets,
            constraints: constraints.to_vec(),
            two_gram_counters: &two_gram_counters,
            cells: cells,
        };

        let board = get_board(&context, [0; 36]);
        if let Some(board) = board {
            let board_text: String = bytes_to_string(board.to_vec());
            println!("{},{}", config_index, board_text);
            /*
            for j in 0..6 {
                println!("{}", &board_text[6 * 3 * j..6 * 3 * (j + 1)]);
            }
            println!("");
            */
        }
    }

    Ok(())
}
