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
    '.github',
    'bench_',
    'rust_test_',
    'settings.json',
    'launch.json',
    '.test.',
    '.gitignore',
    '.gitattributes',
    '.gitkeep',
    '.firebaserc',
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'codecov.yml',
];

// tsgo (allowJs 有効) が .build/ に出力する拡張子。手動コピーは不要。
const COMPILED_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts)$/;

// リポジトリ管理用で実行時に読み込まれない拡張子。
const NON_ASSET_EXTENSIONS = /\.(rs|toml|py|sh|lock|example|patch|rules|ai)$/;

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
// 拡張子のホワイトリスト方式は新しいアセット種別（.yml, .md, .png, .mp3 等）が追加される度に
// 欠落を繰り返してきたため、コンパイル対象/非アセットの拡張子のみを除外するブラックリスト方式にしている。
const trackedFiles = spawnSync('git', ['ls-files'], {encoding: 'utf-8'}) // NOSONAR
    .stdout
    .split('\n')
    .filter((f) => f && !COMPILED_EXTENSIONS.test(f) && !NON_ASSET_EXTENSIONS.test(f))
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
