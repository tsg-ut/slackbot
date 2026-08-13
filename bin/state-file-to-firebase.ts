// NODE_ENV=production npx tsx bin/state-file-to-firebase.ts [state.json] [name]

import 'dotenv/config';

import {promises as fs} from 'fs';
import db from '../lib/firestore.js';

if (process.argv.length !== 4) {
	throw new Error('Usage: npx tsx bin/state-file-to-firebase.ts [state.json] [name]');
}

const file = process.argv[2];
const name = process.argv[3];

const data = await fs.readFile(file, 'utf-8');
const state = JSON.parse(data);
await db.collection('states').doc(name).set(state);
