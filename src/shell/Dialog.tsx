// Small modal dialogs: a question to confirm, and a value to type.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

function useEscape(onCancel: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
}

export function ConfirmDialog({
  title,
  children,
  confirm,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  /** The confirming button's label */
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscape(onCancel);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        {children && <div className="dialog-reason">{children}</div>}
        <div className="dialog-buttons">
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" ref={button} className={`btn${danger ? " danger" : ""}`} onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PromptDialog({
  title,
  label,
  initial = "",
  hint,
  confirm,
  validate,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  initial?: string;
  hint?: ReactNode;
  confirm: string;
  /** An error message for a value that won't do, or null */
  validate?: (value: string) => string | null;
  /** May reject with a message to show */
  onSubmit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  useEscape(onCancel);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    // Select the name, not the folders or the extension
    const start = initial.lastIndexOf("/") + 1;
    const dot = initial.lastIndexOf(".");
    input.current?.setSelectionRange(start, dot > start ? dot : initial.length);
  }, [initial]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validate?.(value.trim()) ?? (value.trim() ? null : "Type something first.");
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-title" onSubmit={submit}>
        <h2 id="prompt-title">{title}</h2>
        <label className="dialog-field">
          <span>{label}</span>
          <input ref={input} value={value} spellCheck={false} onChange={(event) => setValue(event.target.value)} />
        </label>
        {hint && <p className="dialog-note">{hint}</p>}
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-buttons">
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
