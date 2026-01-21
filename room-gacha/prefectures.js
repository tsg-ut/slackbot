"use strict";
// Generation guide for prefectures:
// Go https://suumo.jp/chintai/mansion/ and execute codes below:
//     const uls = Array.from(document.querySelectorAll('.spacebox-list'));
//     const links = [];
//     for (const ul of uls) {
//         links.push(...(ul.children[0].children));
//     }
//     links.forEach(link => {
//         // 代表的市も都道府県扱いされているが、内部的には地域扱いとなるため、
//         // 挙動統一のため削除。
//         if (!link.textContent.includes('市')) {
//             console.log(`${link.textContent}: '${link.href.slice(25, -9)}' as const,`);
//         }
//     });
// 和歌山だけなぜか「県」が抜けているので、手動で「県」を追記。
// All written above is confirmed to be effective as of March 6, 2020.
Object.defineProperty(exports, "__esModule", { value: true });
exports.prefectures = void 0;
exports.prefectures = {
    北海道: 'hokkaido_',
    青森県: 'aomori',
    岩手県: 'iwate',
    秋田県: 'akita',
    宮城県: 'miyagi',
    山形県: 'yamagata',
    福島県: 'fukushima',
    東京都: 'tokyo',
    神奈川県: 'kanagawa',
    千葉県: 'chiba',
    埼玉県: 'saitama',
    茨城県: 'ibaraki',
    栃木県: 'tochigi',
    群馬県: 'gumma',
    山梨県: 'yamanashi',
    長野県: 'nagano',
    石川県: 'ishikawa',
    新潟県: 'niigata',
    富山県: 'toyama',
    福井県: 'fukui',
    愛知県: 'aichi',
    静岡県: 'shizuoka',
    岐阜県: 'gifu',
    三重県: 'mie',
    大阪府: 'osaka',
    兵庫県: 'hyogo',
    京都府: 'kyoto',
    滋賀県: 'shiga',
    奈良県: 'nara',
    和歌山県: 'wakayama',
    愛媛県: 'ehime',
    香川県: 'kagawa',
    高知県: 'kochi',
    徳島県: 'tokushima',
    岡山県: 'okayama',
    広島県: 'hiroshima',
    島根県: 'shimane',
    鳥取県: 'tottori',
    山口県: 'yamaguchi',
    福岡県: 'fukuoka',
    佐賀県: 'saga',
    長崎県: 'nagasaki',
    熊本県: 'kumamoto',
    大分県: 'oita',
    宮崎県: 'miyazaki',
    鹿児島県: 'kagoshima',
    沖縄県: 'okinawa',
};
