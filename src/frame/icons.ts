// Icons for zdrafts' UI on the page: VS Code's codicons (CC BY 4.0, as in zdrafts' own UI), inlined
// as SVG so nothing has to load into the site's page. Codicons has no text alignment icons; those
// three are drawn in the same style.
import arrowDown from "@vscode/codicons/src/icons/arrow-down.svg?raw";
import arrowLeft from "@vscode/codicons/src/icons/arrow-left.svg?raw";
import arrowRight from "@vscode/codicons/src/icons/arrow-right.svg?raw";
import arrowUp from "@vscode/codicons/src/icons/arrow-up.svg?raw";
import bold from "@vscode/codicons/src/icons/bold.svg?raw";
import code from "@vscode/codicons/src/icons/code.svg?raw";
import ellipsis from "@vscode/codicons/src/icons/ellipsis.svg?raw";
import eraser from "@vscode/codicons/src/icons/eraser.svg?raw";
import gripper from "@vscode/codicons/src/icons/gripper.svg?raw";
import italic from "@vscode/codicons/src/icons/italic.svg?raw";
import link from "@vscode/codicons/src/icons/link.svg?raw";
import listOrdered from "@vscode/codicons/src/icons/list-ordered.svg?raw";
import listUnordered from "@vscode/codicons/src/icons/list-unordered.svg?raw";
import quote from "@vscode/codicons/src/icons/quote.svg?raw";
import strikethrough from "@vscode/codicons/src/icons/strikethrough.svg?raw";
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
};

export type IconName = keyof typeof ICONS | `h${1 | 2 | 3 | 4 | 5 | 6}`;

/** An icon's markup: an SVG, or for headings a small "H1"… label in the same size */
export function icon(name: IconName): string {
  if (/^h[1-6]$/.test(name)) return `<span class="heading-icon">H${name[1]}</span>`;
  return ICONS[name as keyof typeof ICONS];
}
