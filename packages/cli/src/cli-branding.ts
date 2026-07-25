import kleur from 'kleur';

const ORANGE_OPEN = '\x1b[38;2;249;115;22m';
const ORANGE_256_OPEN = '\x1b[38;5;208m';
const ORANGE_CLOSE = '\x1b[39m';

export const CLI_BANNER = String.raw`  __  __    ____   ____    _          _      ____  
 |  \/  |  / ___| |  _ \  | |        / \    | __ ) 
 | |\/| | | |     | |_) | | |       / _ \   |  _ \ 
 | |  | | | |___  |  __/  | |___   / ___ \  | |_) |
 |_|  |_|  \____| |_|     |_____| /_/   \_\ |____/ 
                                                   `;

export function formatCliBanner(): string {
  if (!kleur.enabled) return CLI_BANNER;

  const colorOpen = supportsTrueColor() ? ORANGE_OPEN : ORANGE_256_OPEN;
  return `${colorOpen}${CLI_BANNER}${ORANGE_CLOSE}`;
}

export function printCliBanner(): void {
  console.log(formatCliBanner());
}

function supportsTrueColor(): boolean {
  const colorTerm = process.env.COLORTERM?.toLowerCase();
  const term = process.env.TERM?.toLowerCase() ?? '';
  return colorTerm === 'truecolor' || colorTerm === '24bit' || /direct|truecolor/.test(term);
}
