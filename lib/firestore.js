"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.liveDb = exports.db = void 0;
const firebase = __importStar(require("firebase-admin"));
let db = null;
exports.db = db;
let liveDb = null;
exports.liveDb = liveDb;
if (process.env.NODE_ENV === 'production') {
    const defaultApp = firebase.initializeApp({
        credential: firebase.credential.applicationDefault(),
        databaseURL: process.env.FIREBASE_ENDPOINT,
    });
    const liveApp = firebase.initializeApp({
        credential: firebase.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS_LIVE),
        databaseURL: process.env.FIREBASE_ENDPOINT_LIVE,
    }, 'tsg-live');
    exports.db = db = firebase.firestore(defaultApp);
    exports.liveDb = liveDb = firebase.firestore(liveApp);
}
exports.default = db;
