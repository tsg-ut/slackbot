import Mailgun from 'mailgun.js';

// mailgun.js の型定義(CJS形式)は NodeNext 下では default export の型を
// 正しく解決できないため、実行時には正しく解決されるコンストラクタとして
// 明示的にキャストする。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mailgun = new (Mailgun as any)(FormData);
const mg = mailgun.client({
	username: process.env.MAILGUN_USERNAME,
	key: process.env.MAILGUN_API_KEY,
});

export default mg;
