use std::{io, fs};
use std::io::BufRead;
use trie_rs::TrieBuilder;
use std::iter::FromIterator;

fn main() {
    let hiraganas: Vec<char> = "ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわをんー".chars().collect();

    let f = fs::File::open("crossword.txt").unwrap();
    let file = io::BufReader::new(f);
    let mut builder = TrieBuilder::new();

    'lines: for line in file.lines() {
        let word = line.unwrap();
        let mut indices: Vec<u8> = Vec::new();
        for char in word.chars() {
            match hiraganas.iter().position(|&c| c == char) {
                Some(i) => indices.push(i as u8),
                None => continue 'lines,
            }
        }
        builder.push(indices);
    }

    let trie = builder.build();
    let results_in_u8s: Vec<Vec<u8>> = trie.predictive_search([24, 22]);
    let results_in_str: Vec<String> = results_in_u8s
        .iter()
        .map(|word| String::from_iter(word.iter().map(|&i| hiraganas[i as usize])))
        .collect();

    println!("{:?}", results_in_u8s);
    println!("{:?}", results_in_str);
}
