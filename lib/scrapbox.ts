import axios from 'axios';

export const tsgProjectName = process.env.SCRAPBOX_PROJECT_NAME!;
export const tsgScrapboxToken = process.env.SCRAPBOX_SID!;

/**
 * ScrapboxのURLにマッチする正規表現
 * Groups: { projectName, titleLc, hash }
 */
export const pageUrlRegExp = /^https?:\/\/scrapbox\.io\/(?<projectName>.+?)\/(?<titleLc>.+?)(?:#(?<hash>.*))?$/;

/**
 * URLが指定したプロジェクトのURLか判定
 */
export const isPageOfProject = ({ url, projectName = tsgProjectName }: { url: string, projectName?: string }) => {
    const match = url.match(pageUrlRegExp);
    return match !== null && match.groups!.projectName === projectName;
};

/**
 * ScrapboxのURLをトークンをつけてGETリクエスト
 */
export const fetchScrapboxUrl =  async <T> ({ url, token = tsgScrapboxToken }: { url: string; token?: string }): Promise<T> => {
    // TODO: support axios config
    return (await axios.get(
        url,
        { headers: { Cookie: `connect.sid=${token}` } },
    )).data;
}

export interface User {
    id: string;
    name: string;
    displayName: string;
    photo: string;
}

export interface Line {
    id: string;
    text: string;
    userId: string;
    created: number;
    updated: number;
}

export interface Link {
    id: string;
    title: string;
    titleLc: string;
    image?: string;
    descriptions: string[];
    linksLc: string[];
    updated: number;
    accessed: number;
}

/**
 * Scrapbox APIのページ情報の返り値
 */
export interface PageInfo {
    id: string;
    title: string;
    image?: string;
    descriptions: string[];
    user: User;
    pin: number;
    views: number;
    linked: number;
    commitId: string;
    created: number;
    updated: number;
    accessed: number;
    snapshotCreated?: number;
    persistent: boolean;
    lines: Line[];
    links: string[];
    icons: {
        [key: string]: number;
    };
    relatedPages: {
        links1hop: Link[];
        links2hop: Link[];
        icons1hop: unknown[]; // could not find a page that has icons1hop
    }
    collaborators: User[];
    lastAccessed: number;
}


const decodeIfNeeded =  ({ str, isEncoded = undefined }: { str: string; isEncoded?: boolean }): { str: string; isEncoded?: boolean } => {
    if (isEncoded === true || isEncoded === undefined) {
        try {
            str = decodeURIComponent(str);
        } catch (err) {
            // str is not a valid encoded string
            if (isEncoded === true) throw err;
            isEncoded = false;
        }
    }
    return { str, isEncoded };
}

const encodeIfNeeded = ({ str, isEncoded = undefined }: { str: string; isEncoded?: boolean }): { str: string; isEncoded: boolean } => {
    if (isEncoded === undefined) {
        isEncoded = false;
        try {
            if (decodeURIComponent(str) !== str) {
                isEncoded = true;
            }
        } catch {
            // str is not a valid encoded string
        }
    }
    return { str: isEncoded ? str: encodeURIComponent(str),  isEncoded };
}

const parsePageUrl = (url: string): { titleLc: string; projectName: string; hash: string } => {
    const match = url.match(pageUrlRegExp);
    if (match) {
        const { titleLc, projectName, hash } = match.groups!;
        return { titleLc, projectName, hash };
    } else {
        throw Error(`Invalid Scrapbox URL was given: ${url}`);
    }
};

/**
 * Scrapboxの記事
 */
export class Page {
    /**  Scrapbox SID */
    token: string;

    /** Scrapbox プロジェクト名 */
    projectName: string;

    /** URIエンコードされたtitleLc */
    encodedTitleLc: string;

    /** URIエンコードされていないtitleLc */
    titleLc: string

    /** URL末尾のhash */
    hash?: string;

    /**
     * Scrapboxの記事
     * 
     * URLあるいはtitleLc, [プロジェクト名, hash]を指定可能
     * 
     * @param args.token -  Scrapbox SID
     * @param args.isEncoded - URLのtitleLc部分がURIエンコード済みかどうか. デフォルトではurlまたはtitleLcから判断.
     * @param args.url - Scrapbox 記事のURL
     * @param args.titleLc - URL上の記事タイトル. スペースが_に変換されるなど，表示上のタイトルとは異なる場合がある.
     * @param args.projectName - Scrapboxプロジェクト名. デフォルトでは環境変数を用いる
     * @param hash - URL末尾のhash
     */
    constructor(args: {
        token?: string;
        isEncoded?: boolean;
    } & ({
        url: string;
    } | {
        titleLc: string;
        projectName?: string
        hash?: string
    })) {
        this.token = args.token ?? tsgScrapboxToken;
        const { isEncoded: isEncodedGiven } = args;
        const { titleLc, projectName, hash } =
            'titleLc' in args ? args :
            'url' in args ? parsePageUrl(args.url) :
            args as never; // exhaustive check
            // TODO: remove `as never`
            // args should be but is not never here because of a bug of TypeScript (#37039)
        const { str: encodedTitleLc, isEncoded } = encodeIfNeeded({ str: titleLc, isEncoded: isEncodedGiven });
        this.projectName = projectName ?? tsgProjectName;
        this.encodedTitleLc = encodedTitleLc;
        this.titleLc = decodeIfNeeded({ str: titleLc, isEncoded }).str;
        this.hash = hash;
    }

    /**
     * Scrapbox記事のURL
     */
    get url(): string {
        return `https://scrapbox.io/${this.projectName}/${this.encodedTitleLc}${this.hash? `#${this.hash}` : ''}`
    }

    /**
     * ページ情報APIのURL
     */
    get infoUrl(): string {
        return `https://scrapbox.io/api/pages/${this.projectName}/${this.encodedTitleLc}`;
    }

    /**
     * ページ情報をAPIから取得
     */
    async fetchInfo(): Promise<PageInfo> {
        return fetchScrapboxUrl<PageInfo>({ url: this.infoUrl, token: this.token });
    }
}
