use csv;
use std::fs;
use std::error::Error;
use std::collections::BinaryHeap;
use std::cmp::Ordering;
use serde_derive::{Deserialize};

#[derive(Debug, Deserialize, Copy, Clone)]
struct Record {
    station1: usize,
    station2: usize,
    distance: usize,
    line: usize,
}

#[derive(Debug, Clone)]
struct Edge {
    node: usize,
    cost: usize,
}

#[derive(Copy, Clone, Eq, PartialEq)]
struct State {
    cost: usize,
    position: usize,
}

impl Ord for State {
    fn cmp(&self, other: &State) -> Ordering {
        other.cost.cmp(&self.cost).then_with(|| self.position.cmp(&other.position))
    }
}

impl PartialOrd for State {
    fn partial_cmp(&self, other: &State) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn shortest_path(adj_list: &Vec<Vec<Edge>>, start: usize, goal: usize) -> Option<Vec<usize>> {
    let mut dist: Vec<_> = (0..adj_list.len()).map(|_| std::usize::MAX).collect();

    let mut heap = BinaryHeap::new();

    dist[start] = 0;
    heap.push(State { cost: 0, position: start });

    while let Some(State {cost, position}) = heap.pop() {
        if position == goal {
            // reverse search
            let mut cursor = goal;
            let mut cursor_cost = cost;
            let mut nodes = Vec::new();
            nodes.push(goal);
            while cursor != start {
                for edge in &adj_list[cursor] {
                    if cursor_cost - edge.cost == dist[edge.node] {
                        nodes.push(edge.node);
                        cursor = edge.node;
                        cursor_cost -= edge.cost;
                        break;
                    }
                }
            }
            nodes.reverse();
            return Some(nodes);
        }
        if cost > dist[position] {
            continue;
        }

        for edge in &adj_list[position] {
            let next = State { cost: cost + edge.cost, position: edge.node };

            if next.cost < dist[next.position] {
                heap.push(next);
                dist[next.position] = next.cost;
            }
        }
    }

    None
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() != 4 {
        println!("Usage: dijkstra [station1] [station2]");
        panic!("Argument count not satisfied");
    }

    let station1 = args[2].parse()?;
    let station2 = args[3].parse()?;

    let file = fs::File::open("edges.csv")?;
    let mut rdr = csv::ReaderBuilder::new().has_headers(false).from_reader(file);

    let mut records = Vec::new();
    let mut max_station = 0;

    for result in rdr.deserialize() {
        let record: Record = result?;
        records.push(record);
        if max_station < record.station1 {
            max_station = record.station1;
        }
        if max_station < record.station2 {
            max_station = record.station2;
        }
    }

    let mut graph: Vec<Vec<Edge>> = vec![vec![]; (max_station + 1) as usize];

    for record in records {
        graph[record.station1 as usize].push(Edge {
            node: record.station2,
            cost: record.distance,
        });
        graph[record.station2 as usize].push(Edge {
            node: record.station1,
            cost: record.distance,
        });
    }

    match shortest_path(&graph, station1, station2) {
        Some(path) => {
            println!("{}", path.iter().map(|&n| n.to_string()).collect::<Vec<String>>().join(","));;
        },
        None => {
            println!("null");
        },
    }

    Ok(())
}
