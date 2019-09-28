
import * as firebase from 'firebase-admin';

firebase.initializeApp({
	credential: firebase.credential.applicationDefault(),
	databaseURL: process.env.FIREBASE_ENDPOINT,
});

const db = firebase.firestore();

export default db;
