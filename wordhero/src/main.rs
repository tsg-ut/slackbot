use std::{io, fs};
use std::io::BufRead;
use std::iter::FromIterator;
use std::collections::HashMap;
use std::error::Error;
use fst::{IntoStreamer, Set};

fn count_prefix(set: &Set, prefix: Vec<u8>) -> usize {
    let mut prefix_stop = prefix.clone();
    *prefix_stop.last_mut().unwrap() += 1;
    set.range().ge(prefix).lt(prefix_stop).into_stream().into_bytes().len()
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
                Some(i) => indices.push(i as u8),
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

    /*
    let results: Vec<String> = raw_results
        .iter()
        .map(|word| String::from_iter(word.iter().map(|&i| hiraganas[i as usize])))
        .collect();

    println!("{:?}", results);
    */

    Ok(())
}
