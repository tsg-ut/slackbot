class Trie {
	constructor({LBS, label, terminal}) {
		this.lbs = new Uint8Array(LBS);
		this.label = label.toString();
		let ac = 0;
		const accum = [];
		for (let i = 0; i < this.lbs.length; i++) {
			if (this.lbs[i] === 0) ac++;
			accum.push(ac);
		}
		this.accumRank = new Uint32Array(accum);
		this.terminal = new Uint8Array(terminal);
	}
	rank0(index) { // count '0'
		return this.accumRank[index];
	}
	rank1(index) { // count '1'
		return (1 + index) - this.rank0(index);
	}
	select0(rank) { // select i-th '0'
		let left = -1;
		let right = this.accumRank.length - 1;
		while (right - left > 1) {
			const mid = Math.floor((left + right) / 2);
			const midRank = this.rank0(mid);
			if (rank <= midRank) right = mid;
			else left = mid;
		}
		return right;
	}
	dfsWords({index, node, prefix, words, minLength, maxLength}) {
		if (maxLength !== -1 && maxLength < prefix.length) return;
		if ((minLength <= prefix.length) && this.terminal[node-1] === 1) {
			words.push(prefix);
		}
		node = this.rank1(index + 1);
		for (let ite = index + 1; this.lbs[ite] !== 0; ite++, node++) {
			this.dfsWords({
				index: this.select0(node),
				node,
				prefix: prefix + this.label[node-2],
				words,
				minLength,
				maxLength
			});
		}
		return;
	}

	getPrefix(prefix, minLength, maxLength) {
		let index = 1; // root node
		let node = 1;
		for (let pi = 0; pi < prefix.length; pi++) {
			const childBegin = index + 1;
			let find = false;
			node = this.rank1(childBegin);
			for (let ite = childBegin; this.lbs[ite] !== 0; ite++, node++) {
				if (this.label[node-2] === prefix[pi]) {
					find = true;
					index = this.select0(node);
					break;
				}
			}
			if (!find) {
				return [];
			}
		}
		const words = [];
		this.dfsWords({index, node, prefix, words, minLength, maxLength});
		return words;
	}
	tree() {
		return (new TrieNode(this));
	}
}

class TrieNode {
	constructor(trie) {
		this.trie = trie;
		this.index = 1;
		this.history = [];
	}
	step(letter) {
		const childBegin = this.index + 1;
		let node = this.trie.rank1(childBegin);
		for (let ite = childBegin; this.trie.lbs[ite] !== 0; ite++, node++) {
			if (this.trie.label[node-2] === letter) {
				this.history.push(this.index);
				this.index = this.trie.select0(node);
				return true;
			}
		}
		return false;
	}
	back() {
		this.index = this.history.pop();
	}
	isTerminal() {
		const node = this.trie.rank0(this.index);
		return this.trie.terminal[node-1] === 1;
	}
}

module.exports = (x) => {return new Trie(x);};