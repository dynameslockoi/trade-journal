"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Routes where the floating button would only point at the form you are already looking at, or would
 * duplicate a Log Trade button the page already shows — the dashboard's header carries one.
 */
const hidesButton = (path: string) => path === "/" || path === "/journal/new" || /^\/journal\/[^/]+\/edit$/.test(path);

/**
 * The `N` shortcut is a separate question from the button: only the form pages drop it, where it
 * would navigate to the page you are already on. The dashboard keeps it, so a keyboard user who
 * relied on it does not lose the shortcut along with the button they could not see a use for.
 */
const hidesKey = (path: string) => path === "/journal/new" || /^\/journal\/[^/]+\/edit$/.test(path);

/** True while the caret or selection is in a field, so "n" types an n instead of leaving the page. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * Log a trade from anywhere: a floating button bottom-right (above the phone's bottom nav) and the
 * `N` key. The key is ignored while you are typing, when a modifier is held, and while a pop-up
 * (the calendar day dialog, a menu, an open select list) owns the keyboard.
 */
export function QuickAdd() {
  const path = usePathname();
  const router = useRouter();
  const noButton = hidesButton(path);
  const noKey = hidesKey(path);

  useEffect(() => {
    if (noKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "n" && event.key !== "N") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTyping(event.target) || document.querySelector('[role="dialog"]')) return;
      // An open listbox or menu is a keyboard surface of its own — leave "n" to it.
      if (document.querySelector('[role="listbox"], [role="menu"]')) return;
      event.preventDefault();
      router.push("/journal/new");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [noKey, router]);

  if (noButton) return null;

  return (
    <Button asChild className="fab">
      {/* The form is the destination this app reaches most often, so the pointer reaching the button
          starts fetching it (`unstable_dynamicOnHover` + `experimental.dynamicOnHover`); pressing N
          still navigates straight away, with whatever the prefetch has managed by then. */}
      <Link href="/journal/new" unstable_dynamicOnHover aria-keyshortcuts="n" title="Log a trade — press N">
        <Plus size={18} />
        <span className="fab-label">Add trade</span>
        <kbd className="fab-key">N</kbd>
      </Link>
    </Button>
  );
}
