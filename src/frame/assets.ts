// Images into the page: drop or paste image files (they're added under static/images/), or drag
// an image from zdrafts' explorer. The image goes where it's dropped, or at the cursor for a paste.
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { FrameToShell, ShellToFrame } from "./protocol.ts";

// Matches ASSET_DRAG_TYPE in src/shell/Explorer.tsx
const ASSET_DRAG_TYPE = "application/x-zdrafts-path";

export class Assets {
  private pending = new Map<number, (message: Extract<ShellToFrame, { type: "asset-added" }>) => void>();
  private nextId = 1;

  constructor(private post: (message: FrameToShell) => void) {}

  /** Add a file to the site; resolves to its URL there */
  add(file: File): Promise<string> {
    return file.arrayBuffer().then(
      (data) =>
        new Promise((resolve, reject) => {
          const id = this.nextId++;
          this.pending.set(id, (reply) => (reply.src ? resolve(reply.src) : reject(new Error(reply.error ?? "Couldn't add the file"))));
          this.post({ type: "add-asset", id, name: file.name || `pasted-${Date.now()}.${file.type.split("/")[1] ?? "png"}`, data });
        }),
    );
  }

  receive(message: Extract<ShellToFrame, { type: "asset-added" }>) {
    this.pending.get(message.id)?.(message);
    this.pending.delete(message.id);
  }
}

const altText = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();

/** Insert an image at `pos`, in a paragraph of its own when `pos` is between blocks; returns the position after it */
function insertImage(view: EditorView, pos: number, src: string, alt: string): number {
  const { schema } = view.state;
  const image: ProseNode = schema.nodes.image.create({ src, alt });
  const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
  const node = $pos.parent.inlineContent ? image : schema.nodes.paragraph.create(null, image);
  view.dispatch(view.state.tr.insert($pos.pos, node).scrollIntoView());
  return $pos.pos + node.nodeSize;
}

export function assetPlugin(assets: Assets, markDirty: () => void) {
  const addFiles = (view: EditorView, files: File[], pos: number) => {
    markDirty();
    // One after another, each after the previous, so they keep their order
    void files.reduce(
      (at, file) => at.then((next) => assets.add(file).then((src) => insertImage(view, next, src, altText(file.name)), (error) => (console.error("zdrafts:", error), next))),
      Promise.resolve(pos),
    );
  };

  return $prose(
    () =>
      new Plugin({
        props: {
          handleDrop(view, event) {
            const data = (event as DragEvent).dataTransfer;
            if (!data) return false;
            const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
            if (at === undefined) return false;
            const path = data.getData(ASSET_DRAG_TYPE);
            if (path) {
              markDirty();
              insertImage(view, at, `/${path.replace(/^static\//, "")}`, altText(path.split("/").pop()!));
              return true;
            }
            const images = [...data.files].filter((file) => file.type.startsWith("image/"));
            if (!images.length) return false;
            addFiles(view, images, at);
            return true;
          },
          handlePaste(view, event) {
            const images = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
            if (!images.length) return false;
            addFiles(view, images, view.state.selection.from);
            return true;
          },
        },
      }),
  );
}
