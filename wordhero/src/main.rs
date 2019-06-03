use std::{io, fs};
use std::io::BufRead;
use std::time::Instant;
use panoradix::RadixSet;

fn has_prefix(trie: &RadixSet<str>, prefix: &str) -> bool {
    trie.find(prefix).next() != None
}

fn main() {
    let f = fs::File::open("crossword.txt").unwrap();
    let file = io::BufReader::new(f);
    let mut trie: RadixSet<str> = RadixSet::new();
    for line in file.lines() {
        trie.insert(&line.unwrap());
    }
    println!("{:?}", has_prefix(&trie, "すし"));
}
