import db from './firestore';
import State, {StateInterface, StateDevelopment} from './state';

export interface ReadOnlyStateInterface extends StateInterface {
	init<StateObj>(name: string, defaultValues: StateObj): Promise<Readonly<StateObj>>;
}

export const ReadOnlyStateProduction: ReadOnlyStateInterface = class ReadOnlyStateProduction<StateObj> {
	name: string;
	stateObject: StateObj;
	new: (name: string, defaultValues: StateObj) => Partial<StateObj>;

	static async init<StateObj>(name: string, defaultValues: StateObj): Promise<Readonly<StateObj>> {
		const docRef = db.collection('states').doc(name);

		const stateObject = await db.runTransaction(async (transaction) => {
			const doc = await transaction.get(docRef);
			const newState = {
				...defaultValues,
				...(doc?.data() || {}),
			};
			transaction.set(docRef, newState);
			return newState;
		});

		const state = new ReadOnlyStateProduction<StateObj>(name, stateObject);
		docRef.onSnapshot(state.onSnapshot.bind(state));

		return stateObject;
	}

	constructor(name: string, stateObject: StateObj) {
		this.name = name;
		this.stateObject = stateObject;
	}

	private onSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>) {
		const data = snapshot.data();
		Object.assign(this.stateObject, data);
	}
}

/**
 * 読み取り専用の{@link State}クラス。
 *
 * {@link State}と同じインターフェイスを実装しているが、変更はできず、読み取り専用です。
 * DBへの変更はFirestore→ローカルへの一方向にのみ反映され、変更が検出されたら即座にローカルのオブジェクトが変更されます。
 *
 * ```typescript
 * import {ReadOnlyState} from '../lib/state.ts';
 *
 * interface TestState {
 *   a: string,
 *   b: {c: string, d: number[]}[],
 * }
 *
 * const state = await ReadOnlyState.init<TestState>('test', {a: 'hoge', b: [{c: 'fuga', d: []}]});
 *
 * state.a = 'fuga'; // Error: Cannot assign to 'a' because it is a read-only property.
 *
 * // 変更が追跡されるのはstateオブジェクトのルートからアクセスした場合のみです。
 * // 参照を保持した場合そのプロパティに対するDBへの変更はローカルに反映されません。
 * const b1 = state.b[1];
 * console.log(b1.c); // .b[1].cがFirestore上で変更されても反映されない
 * console.log(state.b[1].c); // .b[1].cがFirestore上で変更されたら反映される
 * ```
 */
export const ReadOnlyState: ReadOnlyStateInterface = process.env.NODE_ENV === 'production' ? ReadOnlyStateProduction : StateDevelopment;
