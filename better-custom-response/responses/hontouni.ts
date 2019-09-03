import {tokenize} from 'kuromojin';
import {findLastIndex} from 'lodash';
import { start } from 'repl';

export default async ([text, tail]: string[]): Promise<string[]> => {
    const tokens = await tokenize(text);
    const endPosition = findLastIndex(tokens, ({basic_form}) => (
        basic_form !== 'て' &&
        basic_form !== 'いる' &&
        basic_form !== 'ます' &&
        basic_form !== 'じゃ' &&
        basic_form !== 'ちゃう' &&
        basic_form !== 'た'
    ));
    const startPosition = findLastIndex(tokens, ({pos_detail_1}) => (
        pos_detail_1 === '自立'
    ), endPosition);
    const 語幹Tokens = tokens.slice(
      startPosition === -1 ? 0 : startPosition,
      endPosition === -1 ? -3 : endPosition + 1,
    );
    const 語幹 = 語幹Tokens.map(({surface_form}) => surface_form).join('');
    if (tail[0] === 'て' || tail[0] === 'ち') {
      return [`本当に${語幹}ていますか？`];
    }
    return [`本当に${語幹}でいますか？`];
};