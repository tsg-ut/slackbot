class Point {
	constructor(board, x, y) {
		this.boardWidth = board.width;
		this.boardHeight = board.height;
		const right = this.boardWidth - 1;
		const center = (this.boardWidth - 1) / 2;
		const bottom = this.boardHeight - 1;
		this.x = x;
		this.y = y;
		this.availableDirections = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
		if (y === 0) {
			if (x !== center) {
				this.availableDirections.delete(0);
			}
			if (x === right) {
				this.availableDirections.delete(1);
			}
		}
		if (x === right) {
			this.availableDirections.delete(2);
			if (y === bottom) {
				this.availableDirections.delete(3);
			}
		}
		if (y === bottom) {
			if (x !== center) {
				this.availableDirections.delete(4);
			}
			if (x === 0) {
				this.availableDirections.delete(5);
			}
		}
		if (x === 0) {
			this.availableDirections.delete(6);
			if (y === 0) {
				this.availableDirections.delete(7);
			}
		}
		this.usedDirections = new Set();
	}

	get movableDirections() {
		return new Set([...this.availableDirections].filter((direction) => !this.usedDirections.has(direction)));
	}

	getMoves(direction) {
		const {x, y} = this;
		const right = this.boardWidth - 1;
		const center = (this.boardWidth - 1) / 2;
		const bottom = this.boardHeight - 1;
		if (
			(direction === 1 && x === right - 1 && y === 0) ||
			(direction === 3 && x === right && y === bottom - 1) ||
			(direction === 5 && x === 1 && y === bottom) ||
			(direction === 7 && x === 0 && y === 1)
		) {
			return [
				direction,
				(direction + 2) % 8,
				(direction + 4) % 8,
			];
		}
		if (
			(direction === 1 && x === right && y === 1) ||
			(direction === 3 && x === right - 1 && y === bottom) ||
			(direction === 5 && x === 0 && y === bottom - 1) ||
			(direction === 7 && x === 1 && y === 0)
		) {
			return [
				direction,
				(direction + 6) % 8,
				(direction + 4) % 8,
			];
		}
		if (
			(direction === 1 && x !== center - 1 && y === 0) ||
			(direction === 3 && x === right) ||
			(direction === 5 && x !== center + 1 && y === bottom) ||
			(direction === 7 && x === 0)
		) {
			return [
				direction,
				(direction + 2) % 8,
			];
		}
		if (
			(direction === 1 && x === right) ||
			(direction === 3 && x !== center - 1 && y === bottom) ||
			(direction === 5 && x === 0) ||
			(direction === 7 && x !== center + 1 && y === 0)
		) {
			return [
				direction,
				(direction + 6) % 8,
			];
		}
		return [direction];
	}
}

module.exports = Point;
