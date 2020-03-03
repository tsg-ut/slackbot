import axios from 'axios';
import { escapeRegExp } from 'lodash';

export const tsgProjectName = process.env.SCRAPBOX_PROJECT_NAME!;
export const tsgScrapboxToken = process.env.SCRAPBOX_SID!;

export const getPageUrlRegExp = ({ projectName }: { projectName: string | null }) => 
    new RegExp(`^https?${
        projectName === null ?
            '(?<projectName>.+?)':
            escapeRegExp(`://scrapbox.io/${projectName}/`)
    }(?<titleLc>.+?)(?<hash>#.*)?$`);

export const fetchScrapboxUrl =  async <T> ({ url, token = tsgScrapboxToken }: { url: string; token?: string }): Promise<T> => {
    // TODO: support axios config
    return (await axios.get(
        url,
        { headers: { Cookie: `connect.sid=${token ?? tsgScrapboxToken}` } },
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
    if (isEncoded !== true) {
        try {
            str = decodeURIComponent(str);
        } catch (err) {
            if (isEncoded === false) throw err;
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
    const match = url.match(getPageUrlRegExp({ projectName: null }));
    if (match) {
        const { titleLc, projectName, hash } = match.groups!;
        return { titleLc, projectName, hash };
    } else {
        throw Error(`Invalid Scrapbox URL was given: ${url}`);
    }
};

export class Page {
    token: string;
    projectName: string;
    encodedTitleLc: string;
    titleLc: string;
    hash?: string;

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
        if ('titleLc' in args) {
            // specified titleLc
            const { titleLc, projectName, hash, isEncoded: isEncodedGiven } = args;
            const { str: encodedTitleLc, isEncoded } = encodeIfNeeded({ str: titleLc, isEncoded: isEncodedGiven });
            this.encodedTitleLc = encodedTitleLc;
            this.titleLc = decodeIfNeeded({ str: titleLc, isEncoded }).str;
            this.projectName = projectName ?? tsgProjectName;
            this.hash = hash;
        } else if ('url' in args) {
            // specified url
            const { url, isEncoded: isEncodedGiven } = args;
            const { titleLc, projectName, hash } = parsePageUrl(url);
            const { str: encodedTitleLc, isEncoded } = encodeIfNeeded({ str: titleLc, isEncoded: isEncodedGiven });
            this.encodedTitleLc = encodedTitleLc;
            this.projectName = projectName;
            this.hash = hash;
            this.titleLc = decodeIfNeeded({ str: titleLc, isEncoded: isEncoded }).str;
        } else {
            // TODO: do exhaustive check
            // this check fails because of a bug of TypeScript (#37039)
            /*
            this.projectName = args;
            this.encodedTitleLc = args;
            this.titleLc = args;
            */
        }
    }

    get url(): string {
        return `^https?://scrapbox.io/${this.projectName}/${this.titleLc}${this.hash? `#${this.hash}` : ''}`
    }

    get infoUrl(): string {
        return `https://scrapbox.io/api/pages/${this.projectName}/${this.encodedTitleLc}`;
    }

    async getInfo(): Promise<PageInfo> {
        return fetchScrapboxUrl<PageInfo>({ url: this.infoUrl, token: this.token });
    }
}
