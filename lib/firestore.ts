import * as firebase from 'firebase-admin';

const defaultApp = firebase.initializeApp({
	credential: firebase.credential.applicationDefault(),
	databaseURL: process.env.FIREBASE_ENDPOINT,
});
const liveApp = firebase.initializeApp({
    // @ts-ignore
    credential: firebase.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS_LIVE),
    databaseURL: process.env.FIREBASE_ENDPOINT_LIVE,
}, 'tsg-live');

const db = firebase.firestore(defaultApp);
const liveDb = firebase.firestore(liveApp);

export default db;
export { db, liveDb };
