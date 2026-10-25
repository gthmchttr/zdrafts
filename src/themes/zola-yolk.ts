import type { ThemeAdapter } from "./index.ts";

// https://github.com/gauthamchettiar/zola-yolk, as used by gthmchttr.com (Zola 0.23 components)
export const zolaYolk: ThemeAdapter = {
  id: "zola-yolk",
  name: "zola-yolk",
  matches: (theme) => theme === "zola-yolk",
  editCss: `
    /* Show content the theme hides responsively or behind interaction, so it can be edited */
    .only-mobile, .only-desktop { display: block !important; }
    .tabs .tabs-panels > * { display: block !important; }
    details:not([open]) > :not(summary) { display: block !important; }
  `,
  hiddenComponents: ["meta", "tags", "toc", "toc_items", "series.show", "section_paths", "recents", "related", "post_items", "by_year"],
  componentHints: {
    border: { description: "Framed block", icon: "symbol-namespace", keywords: ["box", "frame"] },
    align: { description: "Align text", icon: "list-flat" },
    center: { description: "Centered block", icon: "list-flat" },
    left: { description: "Left-aligned block", icon: "list-flat" },
    right: { description: "Right-aligned block", icon: "list-flat" },
    wide: { description: "Wider than the text column", icon: "screen-full" },
    row: { description: "Side-by-side columns", icon: "split-horizontal", keywords: ["columns"] },
    col: { description: "One column in a row", icon: "layout-sidebar-left" },
    mobile: { description: "Shown on small screens only", icon: "device-mobile" },
    desktop: { description: "Shown on large screens only", icon: "device-desktop" },
    tabs: { description: "Tabbed panels", icon: "multiple-windows" },
    render: { description: "Mermaid diagram or math", icon: "graph", keywords: ["mermaid", "math", "katex"] },
    quote: { description: "Attributed quotation", icon: "quote" },
    admonition: { description: "Callout box", icon: "info", keywords: ["callout"] },
    note: { description: "Note callout", icon: "note", keywords: ["callout"] },
    tip: { description: "Tip callout", icon: "lightbulb", keywords: ["callout"] },
    info: { description: "Info callout", icon: "info", keywords: ["callout"] },
    warning: { description: "Warning callout", icon: "warning", keywords: ["callout"] },
    danger: { description: "Danger callout", icon: "error", keywords: ["callout"] },
    expand: { description: "Collapsible section", icon: "fold", keywords: ["details", "collapse"] },
    img: { label: "img", description: "Responsive image", icon: "file-media", keywords: ["image", "picture"] },
    icon: { description: "Font Awesome icon", icon: "smiley" },
    elink: { description: "External link", icon: "link-external", keywords: ["link"] },
    mark: { description: "Highlighted text", icon: "symbol-color", keywords: ["highlight"] },
    color: { description: "Coloured text", icon: "symbol-color", keywords: ["colour"] },
    shimmer: { description: "Animated text", icon: "sparkle" },
  },
};
