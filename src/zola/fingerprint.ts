/** A cheap fingerprint to tell whether a file changed (FNV-1a over the bytes, plus length) */
export function fingerprint(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 0x01000193);
  return `${data.length}:${(hash >>> 0).toString(16)}`;
}
