import {tokenize} from 'kuromojin';
import {findLastIndex} from 'lodash';

export default async ([, head, tail]: string[]): Promise<string[]> => {
    const tokens = await tokenize(head + (tail.startsWith('て') ? 'た' : 'だ'));
    const endPosition = findLastIndex(tokens, ({basic_form}) => (
        basic_form !== 'た' &&
        basic_form !== 'だ'
    ));
    const startPosition = findLastIndex(tokens, ({pos, pos_detail_1, basic_form}) => (
        (basic_form !== 'する' && pos_detail_1 === '自立') ||
        pos === '名詞'
    ), endPosition);
    const 語幹Tokens = tokens.slice(
        startPosition === -1 ? 0 : startPosition,
        endPosition === -1 ? -3 : endPosition + 1,
    );
    const 語幹 = 語幹Tokens.map(({surface_form}) => surface_form).join('');
    if (tail.startsWith('て')) {
        return [`:burger-king:「${語幹}てんで！」`];
    }
    return [`:burger-king:「${語幹}でんで！」`];
};

