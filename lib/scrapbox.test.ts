const defaultProjectName = 'default_proj';
process.env.SCRAPBOX_PROJECT_NAME = defaultProjectName;
const defaultToken = 'default_token';
process.env.SCRAPBOX_SID = defaultToken;

jest.mock('axios');
import _axios from 'axios';
const axios = _axios as jest.Mocked<typeof _axios>;

import { getPageUrlRegExp, fetchScrapboxUrl, Page } from './scrapbox';

beforeEach(() => {
    axios.get.mockReset();
})

describe('fetchScrapboxUrl', () => {
    const data = {dummy: 'data'};
    const url = 'dummy_url';
    const token = 'dummy_token';

    beforeEach(() => {
        axios.get.mockResolvedValueOnce({ data });
    });

    it('fetches given URL with given token', async () => {
        const res = await fetchScrapboxUrl({ url, token });
        expect(res).toEqual(data);
        expect(axios.get.mock.calls.length).toBe(1);
        expect(axios.get.mock.calls[0][0]).toBe(url);
        expect(axios.get.mock.calls[0][1]!.headers.Cookie).toContain(token);
    });

    it('uses default token if not specified', async () => {
        await fetchScrapboxUrl({ url });
        expect(axios.get.mock.calls[0][1]!.headers.Cookie).toContain(defaultToken);
    });
});

describe('getPageUrlRegExp', () => {
    const projectName = 'proj';
    const projectName2 = 'proj2';
    const titleLc = 'タイトル';
    const hash = 'hash';

    it('parses URL without hash', () => {
        const match = `https://scrapbox.io/${projectName}/${titleLc}`.match(getPageUrlRegExp({ projectName: null }));
        expect(match).not.toBeNull();
        expect(match!.groups).toMatchObject({ projectName, titleLc });
    });

    it('parses URL without hash', () => {
        const match = `https://scrapbox.io/${projectName}/${titleLc}#${hash}`.match(getPageUrlRegExp({ projectName: null }));
        expect(match).not.toBeNull();
        expect(match!.groups).toMatchObject({ projectName, titleLc, hash });
    });

    it('parses URL when projectName specified', () => {
        const url_ok = `https://scrapbox.io/${projectName}/${titleLc}`;
        const regexp = getPageUrlRegExp({ projectName });
        const match_ok = url_ok.match(regexp);
        expect(match_ok).not.toBeNull();
        expect(match_ok!.groups).toMatchObject({ titleLc });
        const url_ng = `https://scrapbox.io/${projectName2}/${titleLc}`;
        const match_ng = url_ng.match(regexp);
        expect(match_ng).toBeNull();
    });
});

describe('Page', () => {
    const projectName = 'proj';
    const titleLc = 'タイトル';
    const encodedTitleLc = encodeURIComponent(titleLc);
    const hash = 'hash';
    const token = 'token';

    describe('constructor', () => {
        const assertProperties = (page: Page): void => {
            expect(page.token).toBe(token);
            expect(page.projectName).toBe(projectName);
            expect(page.titleLc).toBe(titleLc);
            expect(page.encodedTitleLc).toBe(encodedTitleLc);
            expect(page.hash).toBe(hash);
        };

        const generateURL = ({ projectName, titleLc, hash }: { projectName: string; titleLc: string; hash: string }) => 
            `https://scrapbox.io/${projectName}/${titleLc}#${hash}`;

        it('handles unencoded titleLc', () => {
            assertProperties(new Page({ titleLc, projectName, hash, isEncoded: false, token }));
        });

        it('handles encoded titleLc', () => {
            assertProperties(new Page({ titleLc: encodedTitleLc, projectName, hash, isEncoded: true, token }));
        });

        it('assumes unencoded titleLc to be unencoded', () => {
            assertProperties(new Page({ titleLc, projectName, hash, isEncoded: undefined, token }));
        });

        it('assumes encoded titleLc to be encoded', () => {
            assertProperties(new Page({ titleLc: encodedTitleLc, projectName, hash, isEncoded: undefined, token }));
        });


        it('handles unencoded URL', () => {
            const url = generateURL({ projectName, titleLc, hash });
            assertProperties(new Page({ url, isEncoded: false, token }));
        });

        it('handles encoded URL', () => {
            const url = generateURL({ projectName, titleLc: encodedTitleLc, hash });
            assertProperties(new Page({ url, isEncoded: true, token }));
        });

        it('assumes unencoded URL to be unencoded', () => {
            const url = generateURL({ projectName, titleLc, hash });
            assertProperties(new Page({ url, isEncoded: undefined, token }));
        });

        it('assumes encoded URL to be encoded', () => {
            const url = generateURL({ projectName, titleLc: encodedTitleLc, hash });
            assertProperties(new Page({ url, isEncoded: undefined, token }));
        });
        it('handles encoded URL', () => {
            const url = generateURL({ projectName, titleLc: encodedTitleLc, hash });
            assertProperties(new Page({ url, isEncoded: undefined, token }));
        });

        it('handles missing parameters when specified titleLc', () => {
            const page = new Page({ titleLc });
            expect(page.projectName).toBe(defaultProjectName);
            expect(page.token).toBe(defaultToken);
            expect(page.hash).toBeUndefined();
        });

        it('handles missing parameters when specified URL', () => {
            const page = new Page({ titleLc });
            expect(page.token).toBe(defaultToken);
        });

        it('throws error on invalid URL', () => {
            expect(() => new Page({ url: 'hoge' })).toThrow();
        })
    });
    
    describe('methods', () => {
        let page: Page | null = null;
        beforeEach(() => {
            page = new Page({ titleLc, projectName, hash, token });
        });

        test('.url is correct', () => {
            expect(page!.url).toBe(`https://scrapbox.io/${projectName}/${encodedTitleLc}#${hash}`);
        });

        test('.infoUrl is correct', () => {
            expect(page!.infoUrl).toBe(`https://scrapbox.io/api/pages/${projectName}/${encodedTitleLc}`);
        });

        test('.fetchInfo() fetches from correct URL', async () => {
            axios.get.mockResolvedValueOnce({ data: {} });
            await page!.fetchInfo();
            expect(axios.get.mock.calls.length).toBe(1);
            expect(axios.get.mock.calls[0][0]/* url of 0th call */).toBe(page!.infoUrl);
        });
    });
});
