"use client";
import {
  Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";

/* A themed replacement for <select>.
   The native pop-up is drawn by the browser and ignores the palette — it comes out white with a
   system-blue highlight band, which is the one surface in the app that does not belong to either
   theme. This renders the list itself, so it can use the same tokens as everything else.

   Call sites keep writing native markup: `<Select value={x} onChange={fn}>
   <option value="a">A</option></Select>`. */

type Choice = { value: string; label: ReactNode; text: string; disabled: boolean };

/** Flattens `<option>` children (and any `<optgroup>`) into plain choices. */
function readChoices(children: ReactNode): Choice[] {
  const out: Choice[] = [];
  Children.forEach(children, child => {
    if (!isValidElement<any>(child)) return;
    const props = (child.props ?? {}) as { value?: unknown; children?: ReactNode; disabled?: boolean };
    if (child.type === "option") {
      const label = props.children;
      const text = typeof label === "string" || typeof label === "number" ? String(label) : "";
      out.push({
        value: props.value === undefined ? text : String(props.value),
        label: label ?? text,
        text,
        disabled: !!props.disabled,
      });
    } else if (child.type === "optgroup") {
      out.push(...readChoices(props.children));
    }
  });
  return out;
}

export function Select({
  value, onChange, children, disabled, style, title, className = "",
  id, "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  style?: CSSProperties;
  title?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const choices = useMemo(() => readChoices(children), [children]);
  const selected = choices.findIndex(c => c.value === value);
  const current = selected >= 0 ? choices[selected] : choices[0];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Open onto the current value, and flip upwards when there is no room below.
  useEffect(() => {
    if (!open) return;
    const index = choices.findIndex(c => c.value === value);
    setActive(index < 0 ? 0 : index);
    const box = wrap.current?.getBoundingClientRect();
    if (box) setUp(window.innerHeight - box.bottom < 300 && box.top > window.innerHeight - box.bottom);
  }, [open, value, choices]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A menu wider than its trigger can run off the right edge of the page, which would give the whole
  // app a horizontal scrollbar. Anchor it left, then flip to the trigger's right edge if it would.
  useLayoutEffect(() => {
    if (!open) return;
    const el = menu.current;
    if (!el) return;
    el.style.left = "0";
    el.style.right = "auto";
    if (el.getBoundingClientRect().right > window.innerWidth - 10) {
      el.style.left = "auto";
      el.style.right = "0";
    }
  }, [open, choices.length]);

  // Keep the highlighted row in view without moving the page around it.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const pick = useCallback((choice: Choice | undefined) => {
    if (!choice || choice.disabled) return;
    setOpen(false);
    if (choice.value !== value) onChange(choice.value);
  }, [onChange, value]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(choices.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(choices.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(choices[active]); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className={`select${open ? " is-open" : ""}${up ? " drop-up" : ""}${className ? ` ${className}` : ""}`} ref={wrap} style={style}>
      <button
        type="button"
        id={id}
        className="select-btn"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{current ? current.label : "\u00a0"}</span>
        <ChevronDown className="select-caret" size={15} aria-hidden />
      </button>

      {open && (
        <div className="select-menu" role="listbox" id={listId} ref={menu} aria-label={ariaLabel} onClick={e => e.stopPropagation()}>
          {choices.map((c, i) => (
            <div
              key={`${c.value}-${i}`}
              data-index={i}
              role="option"
              aria-selected={c.value === value}
              className={`select-opt${i === active ? " is-active" : ""}${c.value === value ? " is-selected" : ""}${c.disabled ? " is-disabled" : ""}`}
              onMouseEnter={() => !c.disabled && setActive(i)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(c)}
            >
              <span className="select-opt-label">{c.label}</span>
              {c.value === value && <Check className="select-tick" size={14} aria-hidden />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
