const {promises: fs, createWriteStream} = require('fs');

// https://stackoverflow.com/q/18883601
const deg2rad = (deg) => deg * (Math.PI / 180);
const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
	const R = 6371;
	const dLat = deg2rad(lat2 - lat1);
	const dLon = deg2rad(lon2 - lon1);
	const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	const d = R * c;
	return d;
};

(async () => {
	const joinBuffer = await fs.readFile('join20190405.csv');
	const lineBuffer = await fs.readFile('line20190405free.csv');
	const stationBuffer = await fs.readFile('station20190405free.csv');
	const edgesWriter = createWriteStream('edges.csv');
	const nodesWriter = createWriteStream('nodes.csv');

	const joins = joinBuffer.toString().split('\n').slice(1).map((l) => {
		const [line, station1, station2] = l.split(',');
		return {
			line: parseInt(line),
			station1: parseInt(station1),
			station2: parseInt(station2),
		};
	});
	const lines = lineBuffer.toString().split('\n').slice(1).map((l) => {
		const [id, , name] = l.split(',');
		return {id: parseInt(id), name};
	});
	const stations = stationBuffer.toString().split('\n').slice(1).map((l) => {
		const [id, uid, name, , , line, , , , lon, lat] = l.split(',');
		return {
			id: parseInt(id),
			uid: parseInt(uid),
			name,
			line: parseInt(line),
			lon: parseFloat(lon),
			lat: parseFloat(lat),
		};
	}).filter(({uid}) => !Number.isNaN(uid));
	const uids = Array.from(new Set(stations.map(({uid}) => uid)));
	const linesMap = new Map(lines.map((line) => [line.id, line]));
	const stationsMap = new Map(stations.map((station) => [station.id, station]));
	for (const join of joins) {
		const line = linesMap.get(join.line);
		const station1 = stationsMap.get(join.station1);
		const station2 = stationsMap.get(join.station2);
		if (!station1 || !station2) {
			continue;
		}
		const distance = getDistanceFromLatLonInKm(station1.lat, station1.lon, station2.lat, station2.lon);
		const uid1 = uids.indexOf(station1.uid);
		const uid2 = uids.indexOf(station2.uid);
		const lineId = lines.findIndex(({id}) => line.id === id);
		edgesWriter.write([uid1, uid2, Math.floor(distance * 1000), lineId].join(','));
		edgesWriter.write('\n');
	}
	for (const [id, uid] of uids.entries()) {
		const station = stations.find((s) => s.uid === uid);
		if (station === undefined) {
			console.log(uid);
		}
		nodesWriter.write([id, station.name].join(','));
		nodesWriter.write('\n');
	}
	edgesWriter.end();
	nodesWriter.end();
})();
