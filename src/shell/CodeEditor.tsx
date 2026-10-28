// A CodeMirror 6 editor for front matter and raw Markdown
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { Annotation, EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

export type CodeLanguage = "markdown" | "toml" | "yaml";

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "#1f1f1f", color: "#cccccc", fontSize: "13px", height: "100%" },
    ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", caretColor: "#aeafad", padding: "8px 0" },
    ".cm-gutters": { backgroundColor: "#1f1f1f", color: "#6e7681", border: "none" },
    ".cm-activeLine": { backgroundColor: "#ffffff0a" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#cccccc" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "#264f78 !important" },
    ".cm-cursor": { borderLeftColor: "#aeafad" },
    ".cm-scroller": { overflow: "auto" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: tags.heading, color: "#569cd6", fontWeight: "bold" },
  { tag: [tags.strong], fontWeight: "bold", color: "#569cd6" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "#3794ff" },
  { tag: [tags.keyword, tags.propertyName, tags.definition(tags.propertyName)], color: "#9cdcfe" },
  { tag: [tags.string, tags.special(tags.string)], color: "#ce9178" },
  { tag: [tags.number, tags.bool, tags.atom], color: "#b5cea8" },
  { tag: [tags.comment, tags.meta], color: "#6a9955" },
  { tag: [tags.monospace, tags.processingInstruction], color: "#d7ba7d" },
  { tag: tags.heading1, fontSize: "1.1em" },
]);

function language(lang: CodeLanguage) {
  if (lang === "markdown") return markdown();
  return StreamLanguage.define(lang === "toml" ? toml : yaml);
}

/** Marks a change that comes from outside (a discarded draft…), not from typing */
const External = Annotation.define<boolean>();

export function CodeEditor({
  value,
  language: lang,
  onChange,
  label,
}: {
  value: string;
  language: CodeLanguage;
  onChange: (value: string) => void;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // CodeMirror works with \n; a file with \r\n line endings keeps them when saved
  const eol = useRef(value.includes("\r\n") ? "\r\n" : "\n");
  const normal = (text: string) => text.replace(/\r\n/g, "\n");

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: normal(value),
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          language(lang),
          syntaxHighlighting(highlight),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          theme,
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            // Only the person's edits: following an outside change isn't one
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(External))) {
              onChangeRef.current(update.state.doc.toString().replace(/\n/g, eol.current));
            }
          }),
        ],
      }),
    });
    return () => view.current?.destroy();
    // Recreated per document by its parent (key), so only the first value matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, label]);

  // Follow outside changes (e.g. discarding a draft) without losing the cursor when they're ours
  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== normal(value)) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: normal(value) }, annotations: External.of(true) });
    }
  }, [value]);

  return <div className="cm-host" ref={host} />;
}
