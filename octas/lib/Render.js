class BoardElement {
	constructor(board, boardPaper, Snap) {
		this.board = board;
		this.boardPaper = boardPaper;
		this.Snap = Snap;
		const {width, height} = this.board;
		const hCenter = ((width - 1) / 2 + 1) * 20;
		const vCenter = ((height - 1) / 2 + 1) * 20;
		this.boardEdge = this.boardPaper.rect(0, 0, (width + 1) * 20, (height + 1) * 20).addClass('board-edge');
		this.goalCircleA = this.boardPaper.circle(hCenter, (height + 1) * 20, 5).addClass('board-goal player-a');
		this.goalCircleB = this.boardPaper.circle(hCenter, 0, 5).addClass('board-goal player-b');
		this.traceLine = this.boardPaper.polyline(hCenter, vCenter).addClass('trace-line');
		this.currentPointCircle = this.boardPaper.circle(hCenter, vCenter, 7).addClass('current-point');
		this.updateSize();
		this.arrowMap = new Map();
		this.update();

		board.on('formedTriangle', (oldPoint, newPoint, thirdPoint) => {
			this.visualizeTriangle(oldPoint, newPoint, thirdPoint);
		});
		board.on('undo', () => {
			this.update();
		});
		board.on('win', (/* winner */) => {
			// something
		});
		board.on('switchPlayer', (/* newPlayer */) => {
			// something
		});
		board.on('moved', () => {
			this.update();
		});
		board.on('moving', () => {
			this.boardPaper.selectAll('.triangle').remove();
		});
		board.on('updateSize', () => {
			this.updateSize();
		});
	}

	updateSize() {
		const {width, height} = this.board;
		const hCenter = ((width - 1) / 2 + 1) * 20;
		this.boardPaper.attr({
			viewBox: [-3, -25, (width + 1) * 20 + 6, (height + 1) * 20 + 50],
		});
		this.boardEdge.attr({height: (height + 1) * 20, width: (width + 1) * 20});
		this.boardPaper.selectAll('.board-point').remove();
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				this.boardPaper.circle(20 + 20 * x, 20 + 20 * y, 4).addClass('board-point');
			}
		}
		this.goalCircleA.attr({cx: hCenter, cy: (height + 1) * 20});
		this.goalCircleB.attr({cx: hCenter, cy: 0});

		// Bring to front
		this.boardPaper.append(this.traceLine);
		this.boardPaper.append(this.currentPointCircle);
	}

	update() {
		const player = ['a', 'b'][this.board.activePlayer];
		const currentPoint = this.board.getCurrentPoint();
		this.traceLine.attr({
			points: this.board.trace.map((path) => path.map(([x, y]) => [20 + 20 * x, 20 + 20 * y])),
		});
		const [x, y] = this.board.currentCoords;
		this.currentPointCircle.attr({
			cx: 20 + 20 * x,
			cy: 20 + 20 * y,
		});
		for (const arrow of this.arrowMap) {
			arrow.remove();
		}
		if (currentPoint !== null) {
			this.arrowMap = this.drawArrows(currentPoint);
			const isActive = this.board.isActive();
			if (isActive) {
				this.arrowMap.forEach((arrow, direction) => {
					arrow.click(() => {
						this.board.moveTo(direction);
					});
				});
			}
			this.boardPaper.paper.removeClass('active-a active-b inactive').addClass(`active-${player} ${
				isActive ? '' : 'inactive'
			}`);
		} else {
			this.arrowMap = new Map();
		}
	}

	drawArrows(point) {
		const arrowMap = new Map();
		for (const direction of point.movableDirections) {
			arrowMap.set(direction, this.drawArrow(point, direction));
		}
		return arrowMap;
	}

	drawArrow(point, direction) {
		const matrix = this.Snap.matrix();
		const {x, y} = point;
		const theta = direction * 45;
		matrix.translate(20 + x * 20, 20 + y * 20).rotate(theta);
		let pathData = null;
		if (direction % 2 === 0) {
			// N, E, S, W
			pathData = 'm -4,-13.085935 2,0 0,4.546875 4,0 0,-4.546875 2,0 -4,-4.375 z';
		} else {
			// NE, SE, SW, NW
			const pathDataUpRight = 'm 19.14693,-32.2842712474 0,2 -21.14693,0 0,21.74521 4,0 0,-17.74521 17.14693,0 0,2 4.375,-4 z';
			const pathDataUpRightDown = 'm 32.285156,-9.1367188 -2,0 0,-21.1484372 -32.285156,0 0,21.7460935 4,0 0,-17.7460935 24.285156,0 0,17.1484372 -2,0 4,4.375 z';
			const right = this.board.width - 1;
			const center = (this.board.width - 1) / 2;
			const bottom = this.board.height - 1;
			if (
				(direction === 1 && x === right - 1 && y === 0) ||
				(direction === 3 && x === right && y === bottom - 1) ||
				(direction === 5 && x === 1 && y === bottom) ||
				(direction === 7 && x === 0 && y === 1)
			) {
				pathData = pathDataUpRightDown;
			} else if (
				(direction === 1 && x === right && y === 1) ||
				(direction === 3 && x === right - 1 && y === bottom) ||
				(direction === 5 && x === 0 && y === bottom - 1) ||
				(direction === 7 && x === 1 && y === 0)
			) {
				pathData = pathDataUpRightDown;
				matrix.scale(-1, 1);
			} else if (
				(direction === 1 && x !== center - 1 && y === 0) ||
				(direction === 3 && x === right) ||
				(direction === 5 && x !== center + 1 && y === bottom) ||
				(direction === 7 && x === 0)
			) {
				pathData = pathDataUpRight;
			} else if (
				(direction === 1 && x === right) ||
				(direction === 3 && x !== center - 1 && y === bottom) ||
				(direction === 5 && x === 0) ||
				(direction === 7 && x !== center + 1 && y === 0)
			) {
				pathData = pathDataUpRight;
				matrix.scale(-1, 1);
			} else {
				pathData = 'm -4,-19 2,0 0,10.5 4,0 0,-10.5 2,0 -4,-4.4 z';
			}
		}
		return this.boardPaper.path(pathData).addClass('arrow').transform(matrix);
	}

	visualizeTriangle(point1, point2, point3) {
		this.boardPaper.selectAll('.triangle').remove();
		this.boardPaper.polygon([point1.x, point1.y, point2.x, point2.y, point3.x, point3.y].map((v) => 20 + 20 * v)).addClass('triangle');
	}

	startDrag() {
		this.selectedDirection = null;
		this.boardPaper.addClass('dragging');

		// Bring to front
		this.boardPaper.append(this.currentPointCircle);
	}

	dragTo(clientX, clientY) {
		const inverse = this.Snap.matrix(this.boardPaper.node.getScreenCTM().inverse());
		const svgX = inverse.x(clientX, clientY);
		const svgY = inverse.y(clientX, clientY);
		this.currentPointCircle.attr({
			cx: svgX,
			cy: svgY,
		});
		const [origX, origY] = this.board.currentCoords;
		const dx = svgX - (20 + 20 * origX);
		const dy = svgY - (20 + 20 * origY);
		for (const arrow of this.arrowMap) {
			arrow.removeClass('selected');
		}
		this.selectedDirection = null;
		if (dx * dx + dy * dy > 100) {
			// -PI <= theta <= PI
			const theta = Math.atan2(dy, dx);
			const selectedDirection = (Math.round(theta / (Math.PI / 4)) + 10) % 8;
			const arrow = this.arrowMap.get(selectedDirection);
			if (arrow) {
				arrow.addClass('selected');
				this.selectedDirection = selectedDirection;
			}
		}
	}

	endDrag() {
		this.boardPaper.removeClass('dragging');
		if (this.selectedDirection !== null) {
			this.board.moveTo(this.selectedDirection);
		} else {
			const [x, y] = this.board.currentCoords;
			this.currentPointCircle.attr({
				cx: 20 + 20 * x,
				cy: 20 + 20 * y,
			});
		}
	}
}

module.exports = BoardElement;
