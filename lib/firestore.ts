
import * as firebase from 'firebase-admin';

firebase.initializeApp({
	credential: firebase.credential.applicationDefault(),
	databaseURL: 'https://hakata-shi.firebaseio.com'
});

const db = firebase.firestore();

export default db;
