import * as firebase from 'firebase-admin';

import serviceAccount from '../google_application_credentials_live5.json';

firebase.initializeApp({
    // @ts-ignore
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_ENDPOINT_LIVE5,
});

const db = firebase.firestore();

export default db;
