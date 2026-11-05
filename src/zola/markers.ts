// The comments the chrome build (src/zola/chrome.ts) puts where a page's content goes, read back by
// findPages and by the editor (src/frame/main.ts). Their text is between ``` pairs, which Zola
// leaves out when it counts a page's words.

/** A start marker's comment text */
export const startData = (contentPath: string) => `\`\`\`zdrafts:content:${contentPath}\`\`\``;

/** An end marker's comment text: the editor replaces everything from the start marker to here */
export const endData = (contentPath: string) => `\`\`\`zdrafts:end:${contentPath}\`\`\``;

export const START_MARKER = /<!--```zdrafts:content:(.+?)```-->/g;
