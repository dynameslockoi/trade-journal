"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";

/**
 * The one way to attach pictures to a trade: browse, drop, or paste.
 *
 * A chart is usually already on the clipboard by the time the trade is written up, so paste is the
 * quickest of the three; dropping suits a file saved to disk; the picker is the fallback. All three
 * end in the same `File[]`, so a form only has to upload a list.
 *
 * The limits match the storage bucket's (`supabase/hardening.sql`): 10 MB, images only. Refusing
 * here means the file never reaches the form, where the failure used to surface only on save.
 */
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 12;

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * A stable identity per file, so a drop and a paste of the same picture do not both land.
 *
 * Name and size only: a pasted screenshot arrives named something generic ("image.png"), and two
 * pastes of it carry different `lastModified` stamps, so including the time would let the second
 * one through — which is exactly the double Ctrl+V this is here to absorb.
 */
const keyOf = (f: File) => `${f.name}:${f.size}`;

export function ScreenshotInput({
  files,
  onChange,
  hint = "PNG, JPG or WEBP · up to 10 MB each",
}: {
  files: File[];
  onChange: (next: File[]) => void;
  hint?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  // Read through a ref inside the listeners below: they are registered once, and a stale `files`
  // closure would drop whatever was added before them.
  const current = useRef(files);
  current.current = files;

  function accept(incoming: File[]) {
    const images = incoming.filter(f => f.type.startsWith("image/"));
    const badType = incoming.filter(f => !f.type.startsWith("image/"));
    const tooBig = images.filter(f => f.size > MAX_BYTES);
    const good = images.filter(f => f.size <= MAX_BYTES);

    const next = [...current.current];
    for (const f of good) if (!next.some(x => keyOf(x) === keyOf(f))) next.push(f);

    const notes = [
      ...badType.map(f => `${f.name} — not an image`),
      ...tooBig.map(f => `${f.name} — ${kb(f.size)}, over the 10 MB limit`),
      ...(next.length > MAX_FILES ? [`Only the first ${MAX_FILES} images are kept`] : []),
    ];
    setRefused(notes);
    current.current = next.slice(0, MAX_FILES);
    onChange(current.current);
  }

  // Paste anywhere on the page: the screenshot is already on the clipboard, and reaching for the
  // box first would only slow the write-up down. Text pastes carry no files and are left alone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const picked = items
        .filter(i => i.kind === "file" && i.type.startsWith("image/"))
        .map(i => i.getAsFile())
        .filter((f): f is File => !!f);
      if (!picked.length) return;
      e.preventDefault();
      accept(picked);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // A file dropped beside the box would otherwise be opened by the browser, replacing the form and
  // everything typed into it. Only file drags are intercepted, so dragging text still behaves.
  useEffect(() => {
    const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const guard = (e: DragEvent) => { if (isFileDrag(e)) e.preventDefault(); };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);

  const remove = (key: string) => {
    const next = current.current.filter(f => keyOf(f) !== key);
    current.current = next;
    setRefused([]);
    onChange(next);
  };

  return (
    <div className="shot-input">
      <label
        className={`upload-box${dragging ? " is-dragging" : ""}`}
        onDragEnter={e => { e.preventDefault(); setDragging(true); }}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={e => { e.preventDefault(); setDragging(false); accept(Array.from(e.dataTransfer?.files ?? [])); }}
      >
        <input
          ref={input}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={e => { accept(Array.from(e.target.files ?? [])); if (input.current) input.current.value = ""; }}
        />
        <ImagePlus size={20} aria-hidden className="upload-icon" />
        <div className="upload-title">
          {dragging ? "Drop to attach" : "Add screenshots"}
        </div>
        <div className="upload-hint">
          Click to browse · drag a file here · or paste a screenshot anywhere on the page
        </div>
        <div className="upload-hint mt-1">{hint}</div>
      </label>

      {!!refused.length && (
        <ul className="upload-refused">
          {refused.map(r => <li key={r}>{r}</li>)}
        </ul>
      )}

      {!!files.length && (
        <div className="shot-pending">
          {files.map(f => (
            <PendingShot key={keyOf(f)} file={f} onRemove={() => remove(keyOf(f))} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A file on its way to storage, shown so the wrong screenshot is obvious before saving. */
function PendingShot({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [uri, setUri] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setUri(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="shot-pending-item">
      {uri ? <img src={uri} alt={file.name} /> : null}
      <button type="button" className="shot-pending-remove" onClick={onRemove} aria-label={`Remove ${file.name}`}>
        <X size={13} aria-hidden />
      </button>
      <div className="shot-pending-name" title={file.name}>{kb(file.size)}</div>
    </div>
  );
}
