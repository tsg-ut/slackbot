import {promises as fs} from 'fs';
import {inspect} from 'util';

(async () => {
  const scripts = await fs.readdir('node_modules/@unicode/unicode-13.0.0/Script');
  const out: {[script: string]: RegExp} = {};
  for (const script of scripts) {
    const {default: regex} = await import(`@unicode/unicode-13.0.0/Script/${script}/regex`)
    out[script] = regex;
  }
  console.log(`export default ${inspect(out)} as {[script: string]: RegExp};`);
})();
