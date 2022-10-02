import config from "./config";

export function formatOutlineUnfilled(outline: string[], pieces: string[], focus: number=null): string {
  let tokens: string[] = [];
  for (let i = 0; i < outline.length; i++) {
    if (outline[i] !== '') {
      tokens.push(`${outline[i]}`);
    }
    if (i == outline.length - 1) {
      continue;
    }
    if ((focus === null || focus === i) && !pieces[i]) {
      tokens.push(` ${config.placeholders[i].repeat(5)} `);
    } else {
      tokens.push('◯'.repeat(5));
    }
  }
  tokens.push('?');
  return tokens.join('');
}

export function formatOutlineFilled(outline: string[], pieces: string[]): string {
  let tokens: string[] = [];
  for (let i = 0; i < outline.length; i++) {
    tokens.push(outline[i]);
    if (i == outline.length - 1) {
      continue;
    }
    tokens.push(` *${pieces[i]}* `);
  }
  tokens.push('?');
  return tokens.join('');
}

export function formatOutlineDynamic(outline: string[], pieces: string[]): string {
  if (pieces.every(piece => piece !== null)) {
    return formatOutlineFilled(outline, pieces);
  } else {
    return formatOutlineUnfilled(outline, pieces);
  }
}
