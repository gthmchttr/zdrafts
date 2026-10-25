// The file tree, styled after VS Code's explorer: content/ and static/ of the site
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

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
  onOpen,
}: {
  paths: string[];
  selected: string | null;
  modified: Set<string>;
  onOpen: (path: string) => void;
}) {
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
            className={`tree-row${node.path === focused ? " selected" : ""}${isModified ? " modified" : ""}`}
            title={node.path}
            onClick={() => activate(node)}
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
            {isModified && !node.folder && <span className="status">M</span>}
            {isModified && node.folder && <span className="status">●</span>}
          </div>
        );
      })}
    </div>
  );
}
