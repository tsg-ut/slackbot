// node state-file-to-firebase.js [state.json] [name]

import db from '../lib/firestore.ts';
import {promises as fs} from 'fs';

if (process.argv.length !== 4) {
	throw new Error('Usage: node state-file-to-firebase.js [state.json] [name]');
}

const file = process.argv[2];
const name = process.argv[3];

(async () => {
	const data = await fs.readFile(file);
	const state = JSON.parse(data);
	await db.collection('states').doc(name).set(state);
})();
