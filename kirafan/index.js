"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKirafanCards = exports.kirafanTools = void 0;
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const dbHost = 'https://database.kirafan.cn/database/';
const assetHost = 'https://asset.kirafan.cn/';
exports.kirafanTools = {
    kirafanClassNames: [
        'せんし',
        'まほうつかい',
        'そうりょ',
        'ナイト',
        'アルケミスト',
    ],
    kirafanElementNames: ['炎', '水', '土', '風', '月', '陽'],
    getKirafanCardIllustUrl(cardId) {
        return (assetHost +
            `texture/charauiresource/charaillustchara/charaillust_chara_${cardId}.png`);
    },
    getKirafanCardPictureUrl(cardId) {
        return (assetHost + `texture/charauiresource/characard/characard_${cardId}.png`);
    },
    getKirafanCardBustIllustUrl(cardId) {
        return (assetHost +
            `texture/charauiresource/charaillustbust/charaillust_bust_${cardId}.png`);
    },
};
const getKirafanCards = async (forceUpdate = false) => {
    const { timestamp } = (await (0, util_1.promisify)(fs_1.default.exists)(path_1.default.join(__dirname, 'timestamp.json')))
        ? Object.assign({ timestamp: undefined }, JSON.parse(await (0, util_1.promisify)(fs_1.default.readFile)(path_1.default.join(__dirname, 'timestamp.json'), {
            encoding: 'utf8',
        })))
        : { timestamp: undefined };
    if (!forceUpdate &&
        timestamp &&
        Date.now() - timestamp < 1000 * 60 * 60 * 24) {
        const cards = JSON.parse(await (0, util_1.promisify)(fs_1.default.readFile)(path_1.default.join(__dirname, 'kirafan-cards.json'), {
            encoding: 'utf8',
        }));
        return cards;
    }
    const rawData = {
        characterList: new Array(),
        nameList: new Array(),
        titleList: new Array(),
    };
    await Promise.all([
        axios_1.default.get(dbHost + 'CharacterList.json').then(res => {
            rawData.characterList = res.data;
        }),
        axios_1.default.get(dbHost + 'NamedList.json').then(res => {
            rawData.nameList = res.data;
        }),
        axios_1.default.get(dbHost + 'TitleList.json').then(res => {
            rawData.titleList = res.data;
        }),
    ]);
    const titleArray = (() => {
        const ret = new Array(Math.max(...rawData.titleList.map(elem => elem.m_TitleType)) + 1);
        rawData.titleList.forEach(title => {
            ret[title.m_TitleType] = {
                titleId: title.m_TitleType,
                title: title.m_DisplayName,
            };
        });
        return ret;
    })();
    const nameArray = (() => {
        const ret = new Array(Math.max(...rawData.nameList.map(elem => elem.m_NamedType)) + 1);
        rawData.nameList.forEach(name => {
            ret[name.m_NamedType] = {
                fullname: name.fullName,
                nickname: name.m_NickName,
                profile: name.m_ProfileText,
                cv: name.m_CVText,
                titleId: name.m_TitleType,
            };
        });
        return ret;
    })();
    const cards = rawData.characterList.map(character => {
        const card = {
            cardId: character.m_CharaID,
            fullname: nameArray[character.m_NamedType].fullname,
            nickname: nameArray[character.m_NamedType].nickname,
            title: titleArray[nameArray[character.m_NamedType].titleId].title,
            rare: character.m_Rare,
            class: character.m_Class,
            element: character.m_Element,
        };
        return card;
    });
    await (0, util_1.promisify)(fs_1.default.writeFile)(path_1.default.join(__dirname, 'kirafan-cards.json'), JSON.stringify(cards));
    await (0, util_1.promisify)(fs_1.default.writeFile)(path_1.default.join(__dirname, 'timestamp.json'), JSON.stringify({ timestamp: Date.now() }));
    return cards;
};
exports.getKirafanCards = getKirafanCards;
