use std::{io, fs};
use std::io::BufRead;
use std::time::Instant;
use trie_rs::TrieBuilder;
use panoradix::RadixSet;

fn main() {
    {
        let f = fs::File::open("crossword.txt").unwrap();
        let file = io::BufReader::new(f);
        let mut builder = TrieBuilder::new();  // Inferred `TrieBuilder<u8>` automatically
        for line in file.lines() {
            builder.push(line.unwrap());
        }
        let trie = builder.build();
        let start = Instant::now();
        for _i in 0..100000 {
            trie.predictive_search("すしか");
        }
        let end = start.elapsed();
        println!("trie_rs: {}.{:03}s", end.as_secs(), end.subsec_nanos() / 1_000_000);
    }

    {
        let f = fs::File::open("crossword.txt").unwrap();
        let file = io::BufReader::new(f);
        let mut trie: RadixSet<str> = RadixSet::new();
        for line in file.lines() {
            trie.insert(&line.unwrap());
        }
        let start = Instant::now();
        for _i in 0..100000 {
            trie.find("すしか").next() == None;
        }
        let end = start.elapsed();
        println!("radix_trie: {}.{:03}s", end.as_secs(), end.subsec_nanos() / 1_000_000);
    }
}
