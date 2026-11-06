// Where the chrome build (src/zola/chrome.ts) puts a page's content, and where a component's body
// goes in a probe (src/zola/probe.ts): empty elements, which survive Zola's minify_html (comments
// don't), read back by findPages, the editor (src/frame/main.ts) and the probes.
//
// Each tag is on its own lines, so Markdown passes it through as an HTML block, not a paragraph.
// Content markers sit between comments holding ```: Zola doesn't count words between ``` pairs, so
// they don't change a page's word count or reading time.

const attribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export const START = "zdrafts-start";
export const END = "zdrafts-end";
export const SLOT = "zdrafts-slot";

const uncounted = (html: string) => `<!--\`\`\`-->\n${html}\n<!--\`\`\`-->`;

/** Markdown for the marker where `contentPath`'s content starts */
export const startMarker = (contentPath: string) => uncounted(`<${START} data-zdrafts-path="${attribute(contentPath)}">\n</${START}>`);

/** …and where it ends: the editor replaces everything from the start marker to here */
export const endMarker = (contentPath: string) => uncounted(`<${END} data-zdrafts-path="${attribute(contentPath)}">\n</${END}>`);

/** Markdown for where a component's body goes */
export const SLOT_MARKER = `\n<${SLOT}>\n</${SLOT}>\n`;

/** Start markers in built HTML (minifying may leave the attribute unquoted): the path is group 1, 2 or 3 */
export const START_MARKER = /<zdrafts-start data-zdrafts-path=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

export const markerPath = (match: RegExpMatchArray) => (match[1] ?? match[2] ?? match[3]).replace(/&quot;/g, '"').replace(/&amp;/g, "&");
