import db from './firestore';
import { StateInterface, StateDevelopment } from './state';

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

export const ReadOnlyState: ReadOnlyStateInterface = process.env.NODE_ENV === 'production' ? ReadOnlyStateProduction : StateDevelopment;
