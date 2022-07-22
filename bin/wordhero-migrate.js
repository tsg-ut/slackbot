const xml2js = require('xml2js');
const xmljs = require('xml-js');
const fs = require('fs');

const colors = [
	'#FF6F00',
	'#7E57C2',
	'#0288D1',
	'#388E3C',
	'#F44336',
	'#6D4C41',
	'#EC407A',
	'#01579B',
	'#00838F',
	'#558B2F',
	'#8D6E63',
	'#AB47BC',
	'#1E88E5',
	'#009688',
	'#827717',
	'#E65100',
];

for (const i of Array(1).keys()) {
	const filename = `../wordhero/crossword-board-9.svg`;
	const buf = fs.readFileSync(filename);

	const has = (element, name) => {
		if (element.name === name) {
			return true;
		}
		return (element.elements || []).some((child) => has(child, name));
	}

	const find = (element, name) => {
		if (element.name === name) {
			return element;
		}
		for (const child of element.elements || []) {
			const found = find(child, name);
			if (found) {
				return found;
			}
		}
		return null;
	};

	const normalize = (element) => ({
		[element['#name']]: element.$$ ? element.$$.map((child) => normalize(child)) : [element],
	})

	const xml = xmljs.xml2js(buf);
	const svg = xml.elements.find(({name}) => name === 'svg');

	const newElements = [];

	const orders = [];
	const texts = [];
	const arrows = [];
	for (const element of svg.elements) {
		const hasPolygon = has(element, 'polygon');
		if (element.name === 'text') {
			const text = element.elements.map(({text}) => text).join('');
			const order = text.codePointAt(0) - '①'.codePointAt(0);
			orders.push(order);
			texts.push(element);
		}
		if (element.name === 'g') {
			if (hasPolygon) {
				arrows.push(element);
			} else {
				newElements.push(element);
			}
		}
	}

	for (const i of Array(orders.length).keys()) {
		const index = orders.findIndex((order) => order === i);
		const text = texts[index];
		const arrow = arrows[index];
		const color = colors[i];
		const line = find(arrow, 'line');
		const polygon = find(arrow, 'polygon');

		text.attributes.fill = color;
		line.attributes.stroke = color;
		line.attributes.style = line.attributes.style.replace(/stroke:.+?;/, '');
		polygon.attributes.fill = color;

		newElements.push({
			type: 'element',
			name: 'g',
			elements: [
				arrow,
				text,
			],
		});
	}

	svg.elements = newElements;

	const newXml = xmljs.js2xml(xml);
	fs.writeFileSync(filename, newXml);
}
