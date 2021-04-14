import {throttle, groupBy} from 'lodash';
import db from './firestore';
import {Deferred} from './utils';
import path from 'path';
import fs from 'fs-extra';
import {Mutex} from 'async-mutex';
import {observable} from 'mobx';
import type {IObjectDidChange, IArrayDidChange, IMapDidChange} from 'mobx';
import {deepObserve} from 'mobx-utils';

declare type IChange = IObjectDidChange | IArrayDidChange | IMapDidChange;

const statesDeferred = new Deferred<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>();
(async () => {
	if (process.env.NODE_ENV === 'production') {
		statesDeferred.resolve(await db.collection('states').get());
	}
})();

interface IncrementOperation {
	type: 'increment',
	name: string,
	key: string,
	value: number,
}

interface SetOperation {
	type: 'set',
	name: string,
	key: string,
	value: any,
}

type Operation = IncrementOperation | SetOperation;

const pendingOperations: Operation[] = [];

const updateDb = (operation: Operation) => {
	pendingOperations.push(operation);
	triggerUpdateDb();
};

// TODO: Sync back changes to local state
const triggerUpdateDb = throttle(async () => {
	const operations = pendingOperations.splice(0);
	const states = groupBy(operations, (operation) => operation.name);
	await db.runTransaction(async (transaction) => {
		const stateData = new Map<string, {data: {[name: string]: any}, exists: boolean}>();
		// read before write
		await Promise.all(Object.keys(states).map(async (state) => {
			const stateRef = db.collection('states').doc(state);
			const stateTransaction = await transaction.get(stateRef);
			const data = stateTransaction.data() || {};
			stateData.set(state, {data, exists: stateTransaction.exists});
		}));
		for (const [state, stateOperations] of Object.entries(states)) {
			const stateRef = db.collection('states').doc(state);
			const {data, exists} = stateData.get(state);
			for (const operation of stateOperations) {
				if (operation.type === 'increment') {
					if ({}.hasOwnProperty.call(data, operation.key)) {
						data[operation.key] += operation.value;
					} else {
						data[operation.key] = operation.value;
					}
				}
				if (operation.type === 'set') {
					data[operation.key] = operation.value;
				}
			}
			if (exists) {
				transaction.update(stateRef, data);
			} else {
				transaction.set(stateRef, data);
			}
		}
	});
}, 30 * 1000);

export interface StateInterface {
	init<StateObj>(name: string, defaultValues: StateObj): Promise<StateObj>,
}

export const StateProduction: StateInterface = class StateProduction<StateObj> {
	name: string;
	stateObject: {[key: string]: any};
	new: (name: string, defaultValues: StateObj) => Partial<StateObj>;

	static async init<StateObj>(name: string, defaultValues: StateObj): Promise<StateObj> {
		const statesData = await statesDeferred.promise;
		const stateDoc = statesData.docs.find((doc) => doc.id === name);

		const initialState = {
			...defaultValues,
			...(stateDoc?.data() || {}),
		};

		const stateObject = observable(initialState);

		const state = new StateProduction<StateObj>(name, stateObject);
		deepObserve(stateObject, state.onUpdate.bind(state));

		return stateObject;
	}

	constructor(name: string, initialValues: StateObj) {
		this.name = name;
		this.stateObject = initialValues;
	}

	private onUpdate(change: IChange, path: string, root: StateObj) {
		console.log({change, path, root});
	}
}

export const StateDevelopment: StateInterface = class StateDevelopment<StateObj> {
	name: string;
	statePath: string;
	stateObject: {[key: string]: any};
	mutex: Mutex;
	new: (name: string, defaultValues: StateObj) => Partial<StateObj>;

	static async init<StateObj>(name: string, defaultValues: StateObj): Promise<StateObj> {
		await fs.mkdirp(path.resolve(__dirname, '__state__'));
		const statePath = path.resolve(__dirname, '__state__', `${name}.json`);

		let stateObj = {};
		if (await fs.pathExists(statePath)) {
			const data = await fs.readFile(statePath);
			stateObj = JSON.parse(data.toString());
		} else {
			await fs.writeFile(statePath, JSON.stringify(defaultValues, null, '  '));
		}

		const initialState = {...defaultValues, ...stateObj};

		const stateObject = observable(initialState);

		const state = new StateDevelopment<StateObj>(name, stateObject);
		deepObserve(stateObject, state.onUpdate.bind(state));

		return stateObject;
	}

	constructor(name: string, initialValues: StateObj) {
		this.name = name;
		this.stateObject = initialValues;
		this.statePath = path.resolve(__dirname, '__state__', `${name}.json`);
		this.mutex = new Mutex();
	}

	private onUpdate(change: IChange, path: string, root: StateObj) {
		console.log({change, path, root});
		const data = JSON.stringify(this.stateObject, null, '  ');
		return this.mutex.runExclusive(async () => {
			await fs.writeFile(this.statePath, data);
		});
	}
}

/**
 * State: Slackbotが再起動しても蒸発しないステートデータを保存するためのクラスです。
 * production環境ではFirestore, development環境ではローカルのJSONファイルを用いてデータを保存します。
 *
 * get, set, increment の3つのデータ更新用メソッドはすべて同期的に動作し、ローカルのキャッシュが即座に更新されるようになっています。
 * production環境では30秒に1回データベースがアップデートされます。
 * また、getterとsetterによる shorthand method が定義されているため通常の代入のように記述することができます。
 * ただし数値のインクリメントを行う際は `+=` ではなくincrement()を使用してください。
 *
 * その他のトランザクションを要する処理が必要になったら必要になった人が実装してください。
 *
 * ```typescript
 * import State from '../lib/state.ts';
 *
 * interface TestState {
 *   a: string,
 *   b: number,
 * }
 *
 * const state = await State.init<TestState>('test', {a: 'hoge', b: 100});
 * state.set('a', 'fuga');
 * state.a = 'fuga'; // 上と同じ
 * state.increment('b', 100);
 * ```
 */
const State: StateInterface = process.env.NODE_ENV === 'production' ? StateProduction : StateDevelopment;

export default State;
