use std::{io, fs};
use std::io::BufRead;
use std::time::Instant;
use std::iter::FromIterator;
use trie_rs::TrieBuilder;
use panoradix::RadixSet;
use fst::{IntoStreamer, Streamer, Set};
use fst_regex::Regex;

fn main() {
    let hiraganas: Vec<char> = "ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわをんー".chars().collect();

    {
        let f = fs::File::open("crossword.txt").unwrap();
        let file = io::BufReader::new(f);
        let mut builder = TrieBuilder::new();  // Inferred `TrieBuilder<u8>` automatically
        for line in file.lines() {
            builder.push(line.unwrap());
        }
        let trie = builder.build();
        let start = Instant::now();
        for _i in 0..10_000 {
            trie.predictive_search("すし");
        }
        let end = start.elapsed();
        println!("trie_rs: {}.{:03}s", end.as_secs(), end.subsec_nanos() / 1_000_000);
    }

    {
        let f = fs::File::open("crossword.txt").unwrap();
        let file = io::BufReader::new(f);
        let mut builder = TrieBuilder::new();  // Inferred `TrieBuilder<u8>` automatically
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
        let start = Instant::now();
        for _i in 0..10_000 {
            trie.predictive_search([24, 22]);
        }
        let end = start.elapsed();
        println!("trie_rs (indices): {}.{:03}s", end.as_secs(), end.subsec_nanos() / 1_000_000);
    }

    {
        let f = fs::File::open("crossword.txt").unwrap();
        let file = io::BufReader::new(f);
        let mut trie: RadixSet<str> = RadixSet::new();
        for line in file.lines() {
            trie.insert(&line.unwrap());
        }
        let start = Instant::now();
        for _i in 0..10_000 {
            trie.find("すし").next() == None;
        }
        let end = start.elapsed();
        println!("radix_trie: {}.{:03}s", end.as_secs(), end.subsec_nanos() / 1_000_000);
    }

    {
        let f = fs::File::open("crossword.txt").unwrap();
        let file = io::BufReader::new(f);
        let mut words: Vec<String> = file.lines().map(|line| line.unwrap()).collect();
        words.sort();
        let set = Set::from_iter(words).unwrap();
        /*
        let mut stream1 = set.range().ge("すし").lt("すじ").into_stream();
        println!("{:?}", stream1.next() != None);
        let mut stream2 = set.range().ge("すぢ").lt("すっ").into_stream();
        println!("{:?}", stream2.next() != None);
        */
        let start = Instant::now();
        for _i in 0..10_000 {
            let mut stream = set.range().ge("すし").lt("すじ").into_stream();
            stream.next() == None;
        }
        let end = start.elapsed();
        println!("fst (range): {}.{:03}s", end.as_secs(), end.subsec_nanos() / 1_000_000);
    }

    {
        let f = fs::File::open("crossword.txt").unwrap();
        let file = io::BufReader::new(f);
        let mut words: Vec<String> = file.lines().map(|line| line.unwrap()).collect();
        words.sort();
        let set = Set::from_iter(words).unwrap();
        let start = Instant::now();
        for _i in 0..10_000 {
            let re = Regex::new("すし.*").unwrap();
            let mut stream = set.search(&re).into_stream();
            stream.next() == None;
        }
        let end = start.elapsed();
        println!("fst (regex): {}.{:03}s", end.as_secs(), end.subsec_nanos() / 1_000_000);
    }

    {
        let f = fs::File::open("crossword.txt").unwrap();
        let file = io::BufReader::new(f);
        let mut words: Vec<Vec<u8>> = Vec::new();
        'lines2: for line in file.lines() {
            let word = line.unwrap();
            let mut indices: Vec<u8> = Vec::new();
            for char in word.chars() {
                match hiraganas.iter().position(|&c| c == char) {
                    Some(i) => indices.push(i as u8),
                    None => continue 'lines2,
                }
            }
            words.push(indices);
        }
        words.sort();
        let set = Set::from_iter(words).unwrap();
        let start = Instant::now();
        for _i in 0..10_000 {
            let mut stream = set.range().ge([24, 22]).lt([24, 23]).into_stream();
            stream.next() == None;
        }
        let end = start.elapsed();
        println!("fst (indices, range): {}.{:03}s", end.as_secs(), end.subsec_nanos() / 1_000_000);
    }
}
