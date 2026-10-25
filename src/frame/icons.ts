// Icons for zdrafts' UI on the page: VS Code's codicons (CC BY 4.0, as in zdrafts' own UI), inlined
// as SVG so nothing has to load into the site's page. Codicons has no text alignment icons; those
// three are drawn in the same style.
import arrowDown from "@vscode/codicons/src/icons/arrow-down.svg?raw";
import arrowLeft from "@vscode/codicons/src/icons/arrow-left.svg?raw";
import arrowRight from "@vscode/codicons/src/icons/arrow-right.svg?raw";
import arrowUp from "@vscode/codicons/src/icons/arrow-up.svg?raw";
import bold from "@vscode/codicons/src/icons/bold.svg?raw";
import checklist from "@vscode/codicons/src/icons/checklist.svg?raw";
import circleSlash from "@vscode/codicons/src/icons/circle-slash.svg?raw";
import code from "@vscode/codicons/src/icons/code.svg?raw";
import ellipsis from "@vscode/codicons/src/icons/ellipsis.svg?raw";
import eraser from "@vscode/codicons/src/icons/eraser.svg?raw";
import fileMedia from "@vscode/codicons/src/icons/file-media.svg?raw";
import fold from "@vscode/codicons/src/icons/fold.svg?raw";
import horizontalRule from "@vscode/codicons/src/icons/horizontal-rule.svg?raw";
import symbolMisc from "@vscode/codicons/src/icons/symbol-misc.svg?raw";
import gripper from "@vscode/codicons/src/icons/gripper.svg?raw";
import italic from "@vscode/codicons/src/icons/italic.svg?raw";
import link from "@vscode/codicons/src/icons/link.svg?raw";
import listOrdered from "@vscode/codicons/src/icons/list-ordered.svg?raw";
import listUnordered from "@vscode/codicons/src/icons/list-unordered.svg?raw";
import paintcan from "@vscode/codicons/src/icons/paintcan.svg?raw";
import quote from "@vscode/codicons/src/icons/quote.svg?raw";
import recordKeys from "@vscode/codicons/src/icons/record-keys.svg?raw";
import strikethrough from "@vscode/codicons/src/icons/strikethrough.svg?raw";
import symbolColor from "@vscode/codicons/src/icons/symbol-color.svg?raw";
import symbolNamespace from "@vscode/codicons/src/icons/symbol-namespace.svg?raw";
import symbolSnippet from "@vscode/codicons/src/icons/symbol-snippet.svg?raw";
import table from "@vscode/codicons/src/icons/table.svg?raw";
import tag from "@vscode/codicons/src/icons/tag.svg?raw";
import textSize from "@vscode/codicons/src/icons/text-size.svg?raw";
import trash from "@vscode/codicons/src/icons/trash.svg?raw";

const lines = (rows: [number, number][]) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor">${rows
    .map(([x1, x2], i) => `<rect x="${x1}" y="${3 + i * 3}" width="${x2 - x1}" height="1" rx=".5"/>`)
    .join("")}</svg>`;

const svg = (body: string) => `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor">${body}</svg>`;
const label = (text: string, size = 9) =>
  `<text x="8" y="11.5" text-anchor="middle" font-size="${size}" font-weight="600" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif">${text}</text>`;

const ICONS = {
  "arrow-down": arrowDown,
  "arrow-left": arrowLeft,
  "arrow-right": arrowRight,
  "arrow-up": arrowUp,
  bold,
  code,
  ellipsis,
  eraser,
  gripper,
  italic,
  link,
  "list-ordered": listOrdered,
  "list-unordered": listUnordered,
  quote,
  strikethrough,
  component: symbolNamespace,
  "code-block": symbolSnippet,
  table,
  tag,
  text: textSize,
  trash,
  "align-left": lines([[2, 14], [2, 10], [2, 13], [2, 8]]),
  "align-center": lines([[2, 14], [4, 12], [3, 13], [5, 11]]),
  "align-right": lines([[2, 14], [6, 14], [3, 14], [8, 14]]),
  "align-justify": lines([[2, 14], [2, 14], [2, 14], [2, 10]]),
  "box-border": svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor"/>'),
  "box-dashed": svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-dasharray="2 1.5"/>'),
  "box-shaded": svg('<rect x="2" y="2" width="12" height="12" rx="2" opacity=".45"/>'),
  "columns-2": svg('<rect x="2.5" y="3.5" width="4.5" height="9" rx="1" fill="none" stroke="currentColor"/><rect x="9" y="3.5" width="4.5" height="9" rx="1" fill="none" stroke="currentColor"/>'),
  "columns-3": svg('<rect x="1.5" y="3.5" width="3.4" height="9" rx="1" fill="none" stroke="currentColor"/><rect x="6.3" y="3.5" width="3.4" height="9" rx="1" fill="none" stroke="currentColor"/><rect x="11.1" y="3.5" width="3.4" height="9" rx="1" fill="none" stroke="currentColor"/>'),
  "column-add": svg('<rect x="2.5" y="3.5" width="4.5" height="9" rx="1" fill="none" stroke="currentColor"/><path d="M11.25 5v6M8.25 8h6" stroke="currentColor" fill="none"/>'),
  underline: svg(`${label("U", 10)}<rect x="4" y="13.5" width="8" height="1" rx=".5"/>`),
  superscript: svg('<text x="6" y="13" text-anchor="middle" font-size="10" font-weight="600" font-family="system-ui, sans-serif">x</text><text x="12.5" y="7" text-anchor="middle" font-size="6.5" font-weight="600" font-family="system-ui, sans-serif">2</text>'),
  subscript: svg('<text x="6" y="11" text-anchor="middle" font-size="10" font-weight="600" font-family="system-ui, sans-serif">x</text><text x="12.5" y="14.5" text-anchor="middle" font-size="6.5" font-weight="600" font-family="system-ui, sans-serif">2</text>'),
  keyboard: recordKeys,
  "text-color": symbolColor,
  highlight: paintcan,
  collapsible: fold,
  image: fileMedia,
  task: checklist,
  divider: horizontalRule,
  "inline-component": symbolMisc,
  unwrap: circleSlash,
};

export type IconName = keyof typeof ICONS | `h${1 | 2 | 3 | 4 | 5 | 6}`;

export function isIconName(name: string): name is IconName {
  return name in ICONS || /^h[1-6]$/.test(name);
}

/** An icon's markup: an SVG, or for headings a small "H1"… label in the same size */
export function icon(name: IconName): string {
  if (/^h[1-6]$/.test(name)) return `<span class="heading-icon">H${name[1]}</span>`;
  return ICONS[name as keyof typeof ICONS];
}
