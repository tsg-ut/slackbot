#!/usr/bin/env node
// Copies git-tracked non-TypeScript data files to the .build/ directory after tsgo compilation.
// Required because tsgo only outputs .js files, leaving data files (JSON, GeoJSON, etc.) behind.

'use strict';

const {execSync} = require('child_process');
const {mkdirSync, copyFileSync} = require('fs');
const path = require('path');

const EXCLUDE_PATTERNS = [
    '__testdata__',
    '__mocks__',
    '.eslintrc',
    '.prettierrc',
    'firestore',
    'firebase.json',
    'jest.config',
    'package.json',
    'tsconfig',
    '.devcontainer',
    '.gemini',
    '.claude',
    '.vscode',
    'bench_',
    'rust_test_',
    'settings.json',
    'launch.json',
];

const files = execSync('git ls-files')
    .toString()
    .split('\n')
    .filter((f) => f.match(/\.(json|geojson|txt|csv|html)$/))
    .filter((f) => !EXCLUDE_PATTERNS.some((ex) => f.includes(ex)));

for (const f of files) {
    if (!f) continue;
    const dest = path.join('.build', f);
    mkdirSync(path.dirname(dest), {recursive: true});
    copyFileSync(f, dest);
    console.log(`Copied: ${f}`);
}

console.log(`Done: ${files.length} asset(s) copied.`);
