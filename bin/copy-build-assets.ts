import {spawnSync} from 'node:child_process';
import {mkdirSync, copyFileSync, existsSync} from 'node:fs';
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

const copy = (src: string, dest: string) => {
    mkdirSync(path.dirname(dest), {recursive: true});
    copyFileSync(src, dest);
    console.log(`Copied: ${src}`);
};

// NOSONAR: Absolute path (e.g. /usr/bin/git) is intentionally avoided to support cross-platform builds (Linux, macOS).
const trackedFiles = spawnSync('git', ['ls-files'], {encoding: 'utf-8'})
    .stdout
    .split('\n')
    .filter((f) => f.match(/\.(json|geojson|txt|csv|html)$/))
    .filter((f) => !EXCLUDE_PATTERNS.some((ex) => f.includes(ex)));

for (const f of trackedFiles) {
    if (!f) continue;
    copy(f, path.join('.build', f));
}

for (const f of EXTRA_FILES) {
    if (existsSync(f)) {
        copy(f, path.join('.build', f));
    }
}

console.log(`Done: ${trackedFiles.length} tracked + ${EXTRA_FILES.filter(existsSync).length} extra file(s) copied.`);
