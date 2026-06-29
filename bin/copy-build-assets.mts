import {spawnSync} from 'node:child_process';
import {mkdir, copyFile, access} from 'node:fs/promises';
import path from 'node:path';

// git ls-files では取得できないが .build/ へのコピーが必要なファイル（存在する場合のみコピー）
const EXTRA_FILES = [
    'emoxpand/bigemojis.json',
];

const EXCLUDE_PATTERNS = [
    '__testdata__',
    '__mocks__',
    '.eslintrc',
    '.prettierrc',
    'firestore',
    'firebase.json',
    'package.json',
    'package-lock.json',
    'tsconfig',
    '.devcontainer',
    '.gemini',
    '.claude',
    '.vscode',
    'bench_',
    'rust_test_',
    'settings.json',
    'launch.json',
    '.test.',
];

const exists = async (f: string): Promise<boolean> => {
    try {
        await access(f);
        return true;
    } catch {
        return false;
    }
};

const copy = async (src: string, dest: string) => {
    await mkdir(path.dirname(dest), {recursive: true});
    await copyFile(src, dest);
    console.log(`Copied: ${src}`);
};

// Absolute path (e.g. /usr/bin/git) is intentionally avoided to support cross-platform builds (Linux, macOS).
const trackedFiles = spawnSync('git', ['ls-files'], {encoding: 'utf-8'}) // NOSONAR
    .stdout
    .split('\n')
    .filter((f) => f.match(/\.(json|geojson|txt|csv|html)$/))
    .filter((f) => !EXCLUDE_PATTERNS.some((ex) => f.includes(ex)));

for (const f of trackedFiles) {
    if (!f) continue;
    await copy(f, path.join('.build', f));
}

const extraFilesToCopy = (await Promise.all(EXTRA_FILES.map(async (f) => (await exists(f) ? f : null))))
    .filter((f): f is string => f !== null);

for (const f of extraFilesToCopy) {
    await copy(f, path.join('.build', f));
}

console.log(`Done: ${trackedFiles.length} tracked + ${extraFilesToCopy.length} extra file(s) copied.`);
