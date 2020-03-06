// Generation guide for Prefectures:
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

export const Prefectures = {
    北海道: 'hokkaido_' as const,
    青森県: 'aomori' as const,
    岩手県: 'iwate' as const,
    秋田県: 'akita' as const,
    宮城県: 'miyagi' as const,
    山形県: 'yamagata' as const,
    福島県: 'fukushima' as const,
    東京都: 'tokyo' as const,
    神奈川県: 'kanagawa' as const,
    千葉県: 'chiba' as const,
    埼玉県: 'saitama' as const,
    茨城県: 'ibaraki' as const,
    栃木県: 'tochigi' as const,
    群馬県: 'gumma' as const,
    山梨県: 'yamanashi' as const,
    長野県: 'nagano' as const,
    石川県: 'ishikawa' as const,
    新潟県: 'niigata' as const,
    富山県: 'toyama' as const,
    福井県: 'fukui' as const,
    愛知県: 'aichi' as const,
    静岡県: 'shizuoka' as const,
    岐阜県: 'gifu' as const,
    三重県: 'mie' as const,
    大阪府: 'osaka' as const,
    兵庫県: 'hyogo' as const,
    京都府: 'kyoto' as const,
    滋賀県: 'shiga' as const,
    奈良県: 'nara' as const,
    和歌山県: 'wakayama' as const,
    愛媛県: 'ehime' as const,
    香川県: 'kagawa' as const,
    高知県: 'kochi' as const,
    徳島県: 'tokushima' as const,
    岡山県: 'okayama' as const,
    広島県: 'hiroshima' as const,
    島根県: 'shimane' as const,
    鳥取県: 'tottori' as const,
    山口県: 'yamaguchi' as const,
    福岡県: 'fukuoka' as const,
    佐賀県: 'saga' as const,
    長崎県: 'nagasaki' as const,
    熊本県: 'kumamoto' as const,
    大分県: 'oita' as const,
    宮崎県: 'miyazaki' as const,
    鹿児島県: 'kagoshima' as const,
    沖縄県: 'okinawa' as const,
}

export type Prefecture = keyof typeof Prefectures;