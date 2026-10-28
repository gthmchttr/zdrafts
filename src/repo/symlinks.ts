// Symbolic links in downloaded repositories. Git stores a link as a small file holding its target
// path; GitHub's tree API marks it (mode 120000) and zip archives mark it in the file's attributes.
// zdrafts has no real file system, so a link becomes a copy of what it points at.

/** Paths of the entries a zip archive marks as symbolic links (Unix mode 120000) */
export function zipSymlinks(zip: Uint8Array): Set<string> {
  const links = new Set<string>();
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory record: the last one in the file (a comment may follow it)
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return links;
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < count && offset + 46 <= zip.length; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const madeBy = view.getUint16(offset + 4, true) >> 8;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const mode = view.getUint32(offset + 38, true) >>> 16;
    const name = decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength));
    // 3: made on Unix, so the high bits of the attributes are a file mode
    if (madeBy === 3 && (mode & 0xf000) === 0xa000) links.add(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return links;
}

function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/**
 * Replace links (path → the file holding the link's target) with copies of their targets: a file,
 * or every file under a folder. Links pointing outside the repository are dropped.
 */
export function resolveSymlinks(files: Map<string, Uint8Array>, links: Iterable<string>): void {
  const decoder = new TextDecoder();
  let pending = [...links].filter((link) => files.has(link));
  const targets = new Map(pending.map((link) => [link, decoder.decode(files.get(link)).trim()]));
  for (const link of pending) files.delete(link);
  // Links to links resolve over a few rounds
  for (let round = 0; round < 8 && pending.length; round++) {
    const next: string[] = [];
    for (const link of pending) {
      const target = targets.get(link)!;
      const resolved = target.startsWith("/") ? null : normalize(`${link.split("/").slice(0, -1).join("/")}/${target}`);
      if (resolved === null) continue;
      const file = files.get(resolved);
      if (file) {
        files.set(link, file);
        continue;
      }
      const prefix = `${resolved}/`;
      const inside = [...files].filter(([path]) => path.startsWith(prefix));
      if (inside.length) for (const [path, data] of inside) files.set(`${link}/${path.slice(prefix.length)}`, data);
      else if (targets.has(resolved)) next.push(link);
    }
    pending = next;
  }
}
