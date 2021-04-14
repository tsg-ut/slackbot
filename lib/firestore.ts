import * as firebase from 'firebase-admin';
import {Firestore} from '@google-cloud/firestore';

let db: Firestore = null;
let liveDb: Firestore = null;

if (process.env.NODE_ENV === 'production') {
	const defaultApp = firebase.initializeApp({
		credential: firebase.credential.applicationDefault(),
		databaseURL: process.env.FIREBASE_ENDPOINT,
	});
	const liveApp = firebase.initializeApp({
		credential: firebase.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS_LIVE),
		databaseURL: process.env.FIREBASE_ENDPOINT_LIVE,
	}, 'tsg-live');

	db = firebase.firestore(defaultApp);
	liveDb = firebase.firestore(liveApp);
}

export default db;
export {db, liveDb};
