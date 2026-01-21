"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = [
    {
        type: 'actions',
        elements: [
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: '地点を登録する',
                    emoji: true,
                },
                style: 'primary',
                action_id: 'sunrise_register_point_button',
            },
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: '登録した地点を見る',
                    emoji: true,
                },
                action_id: 'sunrise_list_points_button',
            },
        ],
    },
];
