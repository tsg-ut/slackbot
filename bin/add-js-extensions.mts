import fs from 'fs';
import path from 'path';

const buildDir = path.resolve(import.meta.dirname, '../.build');

function getJsFiles(dir: string): string[] {
	const files = fs.readdirSync(dir, { recursive: true }) as string[];
	return files
		.filter((f) => f.endsWith('.js'))
		.map((f) => path.join(dir, f));
}

const jsFiles = getJsFiles(buildDir);

for (const file of jsFiles) {
	let content = fs.readFileSync(file, 'utf8');
	const fileDir = path.dirname(file);

	const replacePath = (match: string, relativePath: string) => {
		if (/\.(js|json|cjs|mjs)$/.test(relativePath)) {
			return match;
		}

		const absolutePath = path.resolve(fileDir, relativePath);
		
		let newPath = relativePath;
		if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
			const separator = relativePath.endsWith('/') ? '' : '/';
			newPath = `${relativePath}${separator}index.js`;
		} else {
			newPath = `${relativePath}.js`;
		}

		return match.replace(relativePath, newPath);
	};

	content = content.replace(/(from\s+['"])(\.\.?[^'"]*)(['"])/g, (match, p1, p2) => {
		return replacePath(match, p2);
	});

	content = content.replace(/(import\s*\(\s*['"])(\.\.?[^'"]*)(['"]\s*\))/g, (match, p1, p2) => {
		return replacePath(match, p2);
	});

	fs.writeFileSync(file, content, 'utf8');
}

console.log('Added .js extensions to relative imports in .build/');
