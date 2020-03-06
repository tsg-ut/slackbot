export interface PrefectureKeyword {
    北海道: 'hokkaido_';
    札幌市: 'hokkaido_/sa_sapporo';
    青森県: 'aomori';
    岩手県: 'iwate';
    秋田県: 'akita';
    宮城県: 'miyagi';
    仙台市: 'miyagi/sa_sendai';
    山形県: 'yamagata';
    福島県: 'fukushima';
    東京都: 'tokyo';
    神奈川県: 'kanagawa';
    川崎市: 'kanagawa/sa_kawasaki';
    横浜市: 'kanagawa/sa_yokohama';
    相模原市: 'kanagawa/sa_sagamihara';
    千葉県: 'chiba';
    千葉市: 'chiba/sa_chiba';
    埼玉県: 'saitama';
    さいたま市: 'saitama/sa_saitama';
    茨城県: 'ibaraki';
    栃木県: 'tochigi';
    群馬県: 'gumma';
    山梨県: 'yamanashi';
    長野県: 'nagano';
    石川県: 'ishikawa';
    新潟県: 'niigata';
    新潟市: 'niigata/sa_niigata';
    富山県: 'toyama';
    福井県: 'fukui';
    愛知県: 'aichi';
    名古屋市: 'aichi/sa_nagoya';
    静岡県: 'shizuoka';
    静岡市: 'shizuoka/sa_shizuoka';
    浜松市: 'shizuoka/sa_hamamatsu';
    岐阜県: 'gifu';
    三重県: 'mie';
    大阪府: 'osaka';
    大阪市: 'osaka/sa_osaka';
    堺市: 'osaka/sa_sakai';
    兵庫県: 'hyogo';
    神戸市: 'hyogo/sa_kobe';
    京都府: 'kyoto';
    京都市: 'kyoto/sa_kyoto';
    滋賀県: 'shiga';
    奈良県: 'nara';
    和歌山県: 'wakayama';
    愛媛県: 'ehime';
    香川県: 'kagawa';
    高知県: 'kochi';
    徳島県: 'tokushima';
    岡山県: 'okayama';
    岡山市: 'okayama/sa_okayama';
    広島県: 'hiroshima';
    広島市: 'hiroshima/sa_hiroshima';
    島根県: 'shimane';
    鳥取県: 'tottori';
    山口県: 'yamaguchi';
    福岡県: 'fukuoka';
    福岡市: 'fukuoka/sa_fukuoka';
    北九州市: 'fukuoka/sa_kitakyushu';
    佐賀県: 'saga';
    長崎県: 'nagasaki';
    熊本県: 'kumamoto';
    熊本市: 'kumamoto/sa_kumamoto';
    大分県: 'oita';
    宮崎県: 'miyazaki';
    鹿児島県: 'kagoshima';
    沖縄県: 'okinawa';
}
// Generation guide for this interface:
// Go https://suumo.jp/chintai/mansion/ and execute codes below:
//     const uls = Array.from(document.querySelectorAll('.spacebox-list'));
//     const links = [];
//     for (const ul of uls) {
//         links.push(...(ul.children[0].children));
//     }
//     links.forEach(link => {
//         console.log(`${link.textContent}: '${link.href.slice(25, -9)}';`);
//     });
// 和歌山だけなぜか「県」が抜けているので、「県」を追記。
// All written above is as of March 6, 2020.