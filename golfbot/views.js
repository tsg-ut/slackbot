"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPostValues = exports.createPostView = exports.createEditBlocks = void 0;
const slackUtils_1 = require("../lib/slackUtils");
const config_1 = __importDefault(require("./config"));
// https://api.slack.com/reference/surfaces/formatting#escaping
const escapeText = (text) => {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};
const createEditBlocks = () => [
    {
        type: 'actions',
        block_id: 'golfbot_edit',
        elements: [
            {
                type: 'button',
                text: (0, slackUtils_1.plainText)('編集'),
                action_id: 'edit',
                value: 'edit',
            },
        ],
    },
];
exports.createEditBlocks = createEditBlocks;
const createPostView = (initialValues = {}) => {
    const service = initialValues.service ?? 'atcoder';
    const languageOptions = config_1.default[service].languages.map(l => ({
        text: (0, slackUtils_1.plainText)(escapeText(l.name)),
        value: l.id,
    }));
    // maximum number of options is 100
    const languageOptionGroups = [];
    for (let i = 0; i * 100 < languageOptions.length; i++) {
        languageOptionGroups.push({
            label: (0, slackUtils_1.plainText)(`Group ${i + 1}`),
            options: languageOptions.slice(i * 100, (i + 1) * 100),
        });
    }
    return {
        type: 'modal',
        callback_id: 'golfbot_post',
        title: (0, slackUtils_1.plainText)(`コンテストを追加する`),
        submit: (0, slackUtils_1.plainText)(`追加`),
        blocks: [
            {
                type: 'section',
                block_id: 'golfbot_post_service',
                text: (0, slackUtils_1.mrkdwn)(`*形式*`),
                accessory: {
                    type: 'static_select',
                    action_id: 'action',
                    options: [
                        {
                            text: (0, slackUtils_1.plainText)(config_1.default['atcoder'].name),
                            value: 'atcoder',
                        },
                        {
                            text: (0, slackUtils_1.plainText)(config_1.default['anagol'].name),
                            value: 'anagol',
                        },
                    ],
                    initial_option: {
                        text: (0, slackUtils_1.plainText)(config_1.default[service].name),
                        value: service,
                    },
                },
            },
            {
                type: 'input',
                block_id: 'golfbot_post_problem_url',
                label: (0, slackUtils_1.plainText)(`問題 URL`),
                element: {
                    type: 'plain_text_input',
                    action_id: 'action',
                    placeholder: (0, slackUtils_1.plainText)({
                        atcoder: `https://atcoder.jp/contests/abc187/tasks/abc187_a`,
                        anagol: `http://golf.shinh.org/p.rb?delete+blank+lines`,
                    }[service]),
                    ...(initialValues.problemURL ? { initial_value: initialValues.problemURL } : {}),
                },
            },
            {
                type: 'input',
                block_id: 'golfbot_post_language',
                label: (0, slackUtils_1.plainText)('言語'),
                element: {
                    type: 'static_select',
                    action_id: 'action',
                    ...(languageOptionGroups.length === 1 ? { options: languageOptions } : { option_groups: languageOptionGroups }),
                    ...(initialValues.language ? { initial_option: languageOptions.find(l => l.value === initialValues.language) } : {}),
                },
            },
            {
                type: 'input',
                block_id: 'golfbot_post_date',
                label: (0, slackUtils_1.plainText)(`日にち`),
                element: {
                    type: 'datepicker',
                    action_id: 'action',
                    ...(initialValues.date ? { initial_date: initialValues.date } : {}),
                },
            },
            {
                type: 'input',
                block_id: 'golfbot_post_start_time',
                label: (0, slackUtils_1.plainText)(`開始時刻`),
                element: {
                    type: 'timepicker', // time picker element is a beta feature
                    action_id: 'action',
                    ...(initialValues.startTime ? { initial_time: initialValues.startTime } : { initial_time: '15:00' }),
                },
            },
            {
                type: 'input',
                block_id: 'golfbot_post_end_time',
                label: (0, slackUtils_1.plainText)(`終了時刻`),
                element: {
                    type: 'timepicker', // time picker element is a beta feature
                    action_id: 'action',
                    ...(initialValues.endTime ? { initial_time: initialValues.endTime } : { initial_time: '21:00' }),
                },
            },
        ],
    };
};
exports.createPostView = createPostView;
const getPostValues = (values) => ({
    service: values['golfbot_post_service']['action'].selected_option.value,
    problemURL: values['golfbot_post_problem_url']['action'].value ?? '',
    language: values['golfbot_post_language']['action'].selected_option?.value ?? '',
    date: values['golfbot_post_date']['action'].selected_date,
    startTime: values['golfbot_post_start_time']['action'].selected_time,
    endTime: values['golfbot_post_end_time']['action'].selected_time,
});
exports.getPostValues = getPostValues;
