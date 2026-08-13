import dotenv from 'dotenv';

// ESM の static import はエントリポイント本体のコードより先に評価されるため、
// index.ts で dotenv.config() を呼んでも、process.env をモジュールトップレベルで
// 参照するモジュール(lib/slack など)には間に合わない。そのようなモジュールが
// 自身の先頭でこのモジュールを import することで、どの経路から読み込まれても
// .env が反映済みであることを保証する。
//
// テスト時は .env の値がテストの前提を壊すため読み込まない。
if (process.env.NODE_ENV !== 'test') {
	dotenv.config({override: true});
}
