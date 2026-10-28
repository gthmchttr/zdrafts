// The file tree, styled after VS Code's explorer: content/ and static/ of the site
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { canMoveInto } from "./files.ts";

/** What the explorer asks the workbench to do */
export type ExplorerAction =
  | { type: "new"; folder: string; kind: "page" | "section" }
  | { type: "rename"; path: string }
  | { type: "delete"; path: string }
  | { type: "move"; path: string; folder: string };

interface TreeNode {
  name: string;
  path: string;
  folder: boolean;
  children: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", folder: true, children: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const sub = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: sub, folder: i < parts.length - 1, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    node.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

/** The drag data type for a file dragged from the explorer (its path), read by the frame editor */
export const ASSET_DRAG_TYPE = "application/x-zdrafts-path";
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

export function fileIcon(name: string): { icon: string; className: string } {
  const ext = name.split(".").pop()!.toLowerCase();
  if (ext === "md" || ext === "markdown") return { icon: "markdown", className: "icon-md" };
  if (/^(png|jpe?g|gif|webp|avif|svg|ico)$/.test(ext)) return { icon: "file-media", className: "icon-image" };
  if (/^(js|ts|css|scss|json|toml|ya?ml|html|xml)$/.test(ext)) return { icon: "file-code", className: "icon-code" };
  if (ext === "pdf") return { icon: "file-pdf", className: "icon-file" };
  return { icon: "file", className: "icon-file" };
}

interface Row {
  node: TreeNode;
  depth: number;
}

export function Explorer({
  paths,
  selected,
  modified,
  added,
  onOpen,
  onAction,
}: {
  paths: string[];
  selected: string | null;
  modified: Set<string>;
  /** Files that are new (not in the repository yet) */
  added: Set<string>;
  onOpen: (path: string) => void;
  onAction: (action: ExplorerAction) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  /** The folder a drop on this row goes into: the folder itself, or a file's folder */
  const folderOf = (node: TreeNode) => (node.folder ? node.path : node.path.split("/").slice(0, -1).join("/"));
  const dragged = (event: DragEvent) => (event.dataTransfer.types.includes(ASSET_DRAG_TYPE) ? draggedPath.current : null);
  const draggedPath = useRef<string | null>(null);
  const tree = useMemo(() => buildTree(paths), [paths]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["content"]));
  const [focused, setFocused] = useState<string | null>(selected);
  const container = useRef<HTMLDivElement>(null);

  // Reveal the open file
  useEffect(() => {
    if (!selected) return;
    setFocused(selected);
    setExpanded((current) => {
      const next = new Set(current);
      const parts = selected.split("/");
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"));
      return next;
    });
  }, [selected]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        out.push({ node, depth });
        if (node.folder && expanded.has(node.path)) walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, expanded]);

  // Folders show a dot when something inside them changed, like VS Code
  const modifiedFolders = useMemo(() => {
    const folders = new Set<string>();
    for (const path of modified) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    }
    return folders;
  }, [modified]);

  const toggle = (path: string, open?: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open ?? !next.has(path)) next.add(path);
      else next.delete(path);
      return next;
    });

  const activate = (node: TreeNode) => {
    setFocused(node.path);
    if (node.folder) toggle(node.path);
    else onOpen(node.path);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = rows.findIndex((row) => row.node.path === focused);
    const current = rows[index];
    const move = (to: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (row) {
        setFocused(row.node.path);
        container.current?.querySelector(`[data-path="${CSS.escape(row.node.path)}"]`)?.scrollIntoView({ block: "nearest" });
      }
    };
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "ArrowRight":
        if (current?.node.folder) {
          if (!expanded.has(current.node.path)) toggle(current.node.path, true);
          else move(index + 1);
        }
        break;
      case "ArrowLeft":
        if (current?.node.folder && expanded.has(current.node.path)) toggle(current.node.path, false);
        else if (current) {
          const parent = current.node.path.split("/").slice(0, -1).join("/");
          if (parent) setFocused(parent);
        }
        break;
      case "Enter":
      case " ":
        if (current) activate(current.node);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="tree" role="tree" aria-label="Files" tabIndex={0} ref={container} onKeyDown={onKeyDown}>
      {rows.map(({ node, depth }) => {
        const icon = node.folder ? { icon: expanded.has(node.path) ? "folder-opened" : "folder", className: "icon-folder" } : fileIcon(node.name);
        const isModified = node.folder ? modifiedFolders.has(node.path) : modified.has(node.path);
        return (
          <div
            key={node.path}
            data-path={node.path}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={node.folder ? expanded.has(node.path) : undefined}
            aria-selected={node.path === focused}
            className={`tree-row${node.path === focused ? " selected" : ""}${isModified ? " modified" : ""}${node.folder && node.path === dropTarget ? " drop-target" : ""}`}
            title={node.path}
            onClick={() => activate(node)}
            onContextMenu={(event: MouseEvent) => {
              event.preventDefault();
              setFocused(node.path);
              setMenu({ x: event.clientX, y: event.clientY, node });
            }}
            // Files can be dragged onto folders to move them, and images into the page being edited
            draggable={!node.folder}
            onDragStart={(event) => {
              draggedPath.current = node.path;
              event.dataTransfer.setData(ASSET_DRAG_TYPE, node.path);
              event.dataTransfer.setData("text/plain", node.path);
              event.dataTransfer.effectAllowed = IMAGE_FILE.test(node.name) ? "copyMove" : "move";
            }}
            onDragEnd={() => {
              draggedPath.current = null;
              setDropTarget(null);
            }}
            onDragOver={(event) => {
              const path = dragged(event);
              const folder = folderOf(node);
              if (!path || !canMoveInto(path, folder)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (dropTarget !== folder) setDropTarget(folder);
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(event) => {
              const path = dragged(event);
              const folder = folderOf(node);
              setDropTarget(null);
              if (!path || !canMoveInto(path, folder)) return;
              event.preventDefault();
              onAction({ type: "move", path, folder });
            }}
          >
            <span className="indent" aria-hidden="true">
              {Array.from({ length: depth }, (_, i) => (
                <span key={i} style={{ width: i === 0 ? 12 : 16 }} />
              ))}
            </span>
            <span className="twistie" aria-hidden="true">
              {node.folder && <span className={`codicon codicon-chevron-${expanded.has(node.path) ? "down" : "right"}`} />}
            </span>
            <span className={`file-icon codicon codicon-${icon.icon} ${icon.className}`} aria-hidden="true" />
            <span className="name">{node.name}</span>
            {isModified && !node.folder && <span className="status">{added.has(node.path) ? "A" : "M"}</span>}
            {isModified && node.folder && <span className="status">●</span>}
          </div>
        );
      })}
      {menu && (
        <div className="menu tree-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(event) => event.stopPropagation()}>
          {(menu.node.folder ? menu.node.path === "content" || menu.node.path.startsWith("content/") : false) && (
            <>
              <button className="menu-item" role="menuitem" onClick={() => (setMenu(null), onAction({ type: "new", folder: menu.node.path, kind: "page" }))}>
                <span className="codicon codicon-new-file" aria-hidden="true" /> New page here…
              </button>
              <button className="menu-item" role="menuitem" onClick={() => (setMenu(null), onAction({ type: "new", folder: menu.node.path, kind: "section" }))}>
                <span className="codicon codicon-new-folder" aria-hidden="true" /> New section here…
              </button>
            </>
          )}
          {!menu.node.folder && (
            <>
              <button className="menu-item" role="menuitem" onClick={() => (setMenu(null), onAction({ type: "rename", path: menu.node.path }))}>
                <span className="codicon codicon-edit" aria-hidden="true" /> Rename or move…
              </button>
              <button className="menu-item" role="menuitem" onClick={() => (setMenu(null), onAction({ type: "delete", path: menu.node.path }))}>
                <span className="codicon codicon-trash" aria-hidden="true" /> Delete…
              </button>
            </>
          )}
          {menu.node.folder && !(menu.node.path === "content" || menu.node.path.startsWith("content/")) && (
            <div className="menu-file" style={{ color: "var(--faint)" }}>
              Drag files onto a folder to move them
            </div>
          )}
        </div>
      )}
    </div>
  );
}
