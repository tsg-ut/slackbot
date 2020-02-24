import { escapeRegExp } from 'lodash';

export const tsgProjectName = process.env.SCRAPBOX_PROJECT_NAME;

export const getPageUrlRegExp = ({ projectName=tsgProjectName }) =>
    new RegExp(`^https?${escapeRegExp(`://scrapbox.io/${projectName}/`)}(?<pageTitle>.+?)(?<hash>#.*)?$`);

export const getTitleFromPageUrl = ({ url, projectName=tsgProjectName, decode=undefined } : { url: string; projectName?: string; decode?: boolean }): string => {
    let pageName = url.replace(getPageUrlRegExp({ projectName }), '$<pageTitle>');
    if (decode !== false) {
        try {
            pageName = decodeURIComponent(pageName);
        } catch (e) {
            if (decode === true) throw e;
        }
    }
	return pageName;
};

export const getInfoUrl = ({ pageName, projectName = tsgProjectName, isEncoded = undefined }: { pageName: string; projectName?: string; isEncoded?: boolean }) => {
    if (isEncoded === undefined) {
        isEncoded = false;
        try {
            if (decodeURIComponent(pageName) !== pageName) {
                isEncoded = true;
            }
        } catch {
            // pageName is not a valid encoded string
        }
    }
    const encodedPageName = isEncoded ? encodeURIComponent(pageName) : pageName;
    return `https://scrapbox.io/api/pages/${projectName}/${encodedPageName}`;
}

export const getInfoUrlFromPageUrl = ({ url, projectName = tsgProjectName, isEncoded = undefined }: { url: string; projectName?: string, isEncoded?: boolean }): string => {
    let pageName = getTitleFromPageUrl({ url, projectName, decode: false });
    return getInfoUrl({ pageName, projectName, isEncoded });
};
