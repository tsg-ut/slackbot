/* eslint-env node, jest */

const mailhook = require('./index.js');

describe('mail-hook/decodeMailSubject', () => {
  it('decodes subject in ISO-2022-JP correctly', () => {
    // A real-world example from my inbox
    const encodedSubject = '=?iso-2022-jp?B?GyRCRWw1fkJnM1ghITBsSExGfjtuSmc9OE1XOWAbKEI=?= =?iso-2022-jp?B?GyRCISZCZzNYMEZGYiRyJDRAQTVhJE4zJ01NJFgbKEI=?=';
    const decodedSubject = '東京大学　一般入試募集要項・大学案内をご請求の皆様へ';

    expect(mailhook.decodeMailSubject(encodedSubject)).toBe(decodedSubject);
  });

  it('returns already-decoded subject as is', () => {
    const subject = 'あいうえお';
    expect(mailhook.decodeMailSubject(subject)).toBe(subject);
  });
});

describe('mail-hook/decodeMailBody', () => {
  it('decodes body in ISO-2022-JP correctly', () => {
    // Another real-world example
    const encodedBody = '\x1B$BL5M}$M\x1B(B\r\n';
    const decodedBody = '無理ね\r\n';
    
    expect(mailhook.decodeMailBody(encodedBody)).toBe(decodedBody);
  });
  
  it('decodes body in UTF-8 + base64', () => {
    // Another real-world example
    const encodedBody = '44KP44GE44Gv44Gd44Gu5pmC6ZaT44G+44Gg5o6I5qWt5Lit44Gq44KT44KE44GMDQo=\r\n';
    const decodedBody = 'わいはその時間まだ授業中なんやが\r\n';

    expect(mailhook.decodeMailBody(encodedBody)).toBe(decodedBody);
  });

  it('returns ASCII body as is', () => {
    const body = 'hoge\r\n';
    expect(mailhook.decodeMailBody(body)).toBe(body);
  });
});
