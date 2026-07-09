import type {View} from '@slack/web-api';
import type {StateObj} from '../HelloWorld.js';

export default (state: StateObj): View => ({
	type: 'modal',
	callback_id: `helloworld_${state.uuid}_edit_counter_dialog`,
	title: {
		text: 'カウンターの編集',
		type: 'plain_text',
	},
	submit: {
		text: '保存',
		type: 'plain_text',
	},
	notify_on_close: true,
	blocks: [
		{
			type: 'input',
			block_id: 'counter_input',
			element: {
				type: 'number_input',
				action_id: 'counter_input',
				is_decimal_allowed: false,
				min_value: '0',
				max_value: '10000000000',
				initial_value: state.counter.toString(),
			},
			label: {
				type: 'plain_text',
				text: 'カウンターの値',
			},
		},
	],
});

