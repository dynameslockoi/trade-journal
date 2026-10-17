"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ExternalLink, Images, Maximize2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type Shot = {
  id: string;
  storage_path: string;
  kind?: string | null;
  caption?: string | null;
};

/**
 * The two charts a trade usually has: the one from the way in, and the one from the way out.
 *
 * The column has always been there, but every row was written with the schema's own placeholder
 * (`"after"`), so it drew no distinction between anything. These are the only two values the app
 * writes as a label; anything else — including every row written before this — reads as unlabelled,
 * and one click in the viewer names it. That is deliberate: a guess at which of somebody's charts was
 * the entry would be worse than saying nothing, and the screenshot that prompted this had no way to
 * tell them apart.
 */
type Kind = "entry" | "exit";
const KINDS: Kind[] = ["entry", "exit"];
/** What the column holds until a trader says otherwise — the schema's `default 'after'`. */
const UNLABELLED = "after";

function kindOf(shot: Shot): Kind | null {
  return shot.kind === "entry" || shot.kind === "exit" ? shot.kind : null;
}

const kindLabel = (kind: Kind) => (kind === "entry" ? "Entry" : "Exit");

/**
 * A chart capture's width ÷ height, kept inside the range a plate can usefully hold.
 *
 * Every capture is a TradingView window, so nearly all of them are about 16:9 — but the ratio is read
 * from the loaded picture instead of assumed, so a chart taller or wider than the usual window still
 * fills its plate. The clamp is what keeps a phone-shaped screenshot from pushing a two-metre image
 * into the page: below 1.45 the picture is letterboxed inside the frame rather than driving its height.
 */
const frameRatio = (width: number, height: number) => {
  if (!width || !height) return null;
  return Math.min(2.6, Math.max(1.45, width / height));
};

/**
 * Screenshots as chart plates: the first one wide enough to read, each opening at full size beside a
 * note box, so what the chart shows is written down next to it rather than in a note somewhere else.
 *
 * The grid used to be two fixed-height thumbnails with `object-fit: contain`, which shrank a wide
 * Bursa chart into a strip floating in the middle of an empty box — the one picture the section exists
 * for was the least readable thing on the page. The first plate now takes the card's full width and
 * every frame takes the picture's own proportions once it loads, so a 16:9 capture fills its plate
 * exactly. What is left of the old box is the backdrop behind an unusually shaped capture.
 */
export function ScreenshotGallery({
  shots,
  onRemove,
  emptyHint = "Edit this trade to add a TradingView screenshot of the setup.",
}: {
  shots: Shot[];
  onRemove?: (shot: Shot) => void;
  emptyHint?: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Distinguishes "still signing" from "the signature came back empty" — otherwise a storage failure
  // sat on screen as "Loading image…" forever.
  const [signed, setSigned] = useState(false);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  // A note saved in this session, so the grid and the box agree without a reload.
  const [saved, setSaved] = useState<Record<string, string>>({});
  // Labels set in this session. `null` is a value here, not an absence: it is how an unlabelled
  // chart is remembered after the label it came with is taken off again.
  const [kinds, setKinds] = useState<Record<string, Kind | null>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const paths = useMemo(() => shots.map(x => x.storage_path).join("|"), [shots]);

  // A signed URL is good for an hour; signing each path once keeps a grid of them from re-signing on
  // every render.
  useEffect(() => {
    let live = true;
    setSigned(false);
    (async () => {
      const s = createClient();
      const pairs = await Promise.all(shots.map(async shot => {
        const { data } = await s.storage.from("trade-screenshots").createSignedUrl(shot.storage_path, 3600);
        return [shot.id, data?.signedUrl ?? ""] as const;
      }));
      if (!live) return;
      const next: Record<string, string> = {};
      for (const [id, url] of pairs) next[id] = url;
      setUrls(next);
      setSigned(true);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  const index = shots.findIndex(x => x.id === openId);
  const open = index >= 0 ? shots[index] : null;
  const captionOf = (shot: Shot) => saved[shot.id] ?? shot.caption ?? "";
  const kindFor = (shot: Shot) => (shot.id in kinds ? kinds[shot.id] : kindOf(shot));
  /** The label of the chart the viewer is showing, which the title chip and the control both read. */
  const openKind = open ? kindFor(open) : null;

  function show(shot: Shot) {
    setOpenId(shot.id);
    setDraft(captionOf(shot));
  }

  function step(by: number) {
    if (shots.length < 2) return;
    show(shots[(index + by + shots.length) % shots.length]);
  }

  // The arrows only work while the viewer is open, and never while a note is being written: there the
  // left and right keys belong to the caret.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      // The remove confirmation sits over this viewer: moving the carousel underneath it would
      // leave the question ("Remove this screenshot?") pointing at a picture the answer no longer
      // matches.
      if (el?.closest?.('[data-slot="alert-dialog-content"]')) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, index, shots.length]);

  /**
   * Name this chart — or take the name off again, by pressing the one that is already on.
   *
   * Saved on the press rather than with the note: a label is one fact about the picture, and making
   * it wait behind a text box would mean the mark is lost whenever somebody labels a chart and closes
   * the viewer. A failure puts the previous label back rather than leaving the chip claiming a write
   * that did not happen.
   */
  async function mark(kind: Kind) {
    if (!open) return;
    const before = kindFor(open);
    const next = before === kind ? null : kind;
    setKinds(m => ({ ...m, [open.id]: next }));
    const { error } = await createClient()
      .from("trade_screenshots")
      .update({ kind: next ?? UNLABELLED })
      .eq("id", open.id);
    if (error) {
      setKinds(m => ({ ...m, [open.id]: before }));
      toast.error(error.message);
      return;
    }
    toast.success(next ? `This chart is the ${next}` : "Chart label removed");
  }

  async function saveNote() {
    if (!open) return;
    setSaving(true);
    const text = draft.trim();
    const { error } = await createClient()
      .from("trade_screenshots")
      .update({ caption: text === "" ? null : text })
      .eq("id", open.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setSaved(x => ({ ...x, [open.id]: text }));
    toast.success("Note saved");
  }

  if (!shots.length) {
    return (
      <div className="shot-empty">
        <span className="shot-empty-icon"><Images size={18} aria-hidden /></span>
        <div>
          <div className="shot-empty-title">No charts attached</div>
          <div className="shot-empty-hint">{emptyHint}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="shot-grid">
        {shots.map((shot, i) => {
          const caption = captionOf(shot);
          const kind = kindFor(shot);
          const ratio = ratios[shot.id];
          const url = urls[shot.id];
          return (
            <figure className="shot-figure" key={shot.id}>
              <button
                type="button"
                className="shot-plate"
                onClick={() => show(shot)}
                aria-label={`${caption || "Screenshot"} — open image ${i + 1} of ${shots.length}`}
              >
                <span className="shot-frame" style={ratio ? { aspectRatio: String(ratio) } : undefined}>
                  {url
                    ? <img
                        src={url}
                        alt={caption || `Trade screenshot ${i + 1}`}
                        loading="lazy"
                        onLoad={e => {
                          const next = frameRatio(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
                          if (!next) return;
                          setRatios(cur => (cur[shot.id] === next ? cur : { ...cur, [shot.id]: next }));
                        }}
                      />
                    : <span className="shot-frame-state">
                        {signed ? "Image unavailable" : <><span className="spinner" aria-hidden /> Loading chart…</>}
                      </span>}
                </span>
                <span className="shot-expand"><Maximize2 size={12} aria-hidden /> View</span>
              </button>
              {/* The label sits in the caption row, not over the picture: a plate's top-left corner is
                  where a TradingView capture prints its symbol and OHLC, which is exactly the part of
                  the chart a chip would cover. */}
              <figcaption className="shot-meta">
                {kind && <span className="shot-kind">{kindLabel(kind)}</span>}
                <span className={`shot-caption${caption ? "" : " shot-caption-empty"}`}>
                  {caption || "Add a note about this chart"}
                </span>
              </figcaption>
            </figure>
          );
        })}
      </div>

      {open && (
        <Dialog open onOpenChange={next => { if (!next) setOpenId(null); }}>
          <DialogContent className="dialog-wide shot-dialog" aria-describedby={undefined}>
            <div className="shot-dialog-head">
              <div>
                <div className="shot-title">
                  {/* A trade with one chart is the common case, and numbering it "1 of 1" reads like a
                      set that failed to arrive. */}
                  <DialogTitle>{shots.length === 1 ? "Screenshot" : `Screenshot ${index + 1} of ${shots.length}`}</DialogTitle>
                  {openKind && <span className="shot-kind">{kindLabel(openKind)}</span>}
                </div>
                {shots.length > 1 && <span className="muted shot-dialog-hint">Use ← → to move between charts</span>}
              </div>
              {shots.length > 1 && (
                <div className="shot-nav">
                  <Button type="button" variant="secondary" size="icon" onClick={() => step(-1)} aria-label="Previous screenshot"><ChevronLeft size={16} /></Button>
                  <Button type="button" variant="secondary" size="icon" onClick={() => step(1)} aria-label="Next screenshot"><ChevronRight size={16} /></Button>
                </div>
              )}
            </div>

            <div className="shot-view">
              {urls[open.id]
                ? <img src={urls[open.id]} alt={captionOf(open) || `Trade screenshot ${index + 1}`} />
                : <span className="shot-frame-state">
                    {signed ? "Image unavailable" : <><span className="spinner" aria-hidden /> Loading chart…</>}
                  </span>}
            </div>

            <div className="shot-mark">
              <span className="shot-mark-label" id="shot-kind-label">This chart shows</span>
              <div className="shot-choice" role="group" aria-labelledby="shot-kind-label">
                {KINDS.map(k => (
                  <button
                    key={k}
                    type="button"
                    className="shot-choice-btn"
                    aria-pressed={openKind === k}
                    onClick={() => mark(k)}
                  >
                    {kindLabel(k)}
                  </button>
                ))}
              </div>
            </div>

            <div className="shot-note">
              <Label htmlFor="shot-comment">Chart note</Label>
              <Textarea
                id="shot-comment"
                rows={3}
                placeholder="What the chart shows — the setup, where you entered, and what you would do differently."
                value={draft}
                onChange={e => setDraft(e.target.value)}
              />
            </div>

            <div className="shot-dialog-foot">
              <div className="shot-dialog-actions">
                {onRemove && (
                  <ConfirmButton
                    size="sm"
                    title="Remove this screenshot?"
                    description="The image is deleted from storage as well as from this trade."
                    confirmLabel="Remove"
                    onConfirm={() => { setOpenId(null); onRemove(open); }}
                  >
                    Remove
                  </ConfirmButton>
                )}
                {urls[open.id] && (
                  <Button type="button" variant="secondary" size="sm" asChild>
                    <a href={urls[open.id]} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} aria-hidden /> Open full size
                    </a>
                  </Button>
                )}
              </div>
              <div className="shot-dialog-actions">
                <Button type="button" variant="secondary" onClick={() => setOpenId(null)}>Close</Button>
                <Button type="button" disabled={saving || draft.trim() === captionOf(open).trim()} onClick={saveNote}>
                  {saving ? "Saving…" : "Save note"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
