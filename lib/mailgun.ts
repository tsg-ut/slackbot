import Mailgun from 'mailgun.js';

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
	username: process.env.MAILGUN_USERNAME,
	key: process.env.MAILGUN_API_KEY,
});

export default mg;
