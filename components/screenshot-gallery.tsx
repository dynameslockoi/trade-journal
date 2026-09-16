"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type Shot = {
  id: string;
  storage_path: string;
  kind?: string | null;
  caption?: string | null;
};

/**
 * Screenshots as a clickable grid: the thumbnail opens the picture at full size beside a comment
 * box, so what the chart shows is written down next to it rather than in a note somewhere else.
 *
 * Without this the grid was the whole story — a Bursa chart rendered at cell width is unreadable, and
 * an image had nowhere to say what it was.
 */
export function ScreenshotGallery({ shots, onRemove }: { shots: Shot[]; onRemove?: (shot: Shot) => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Comments saved in this session, so the grid and the box agree without a reload.
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const paths = useMemo(() => shots.map(x => x.storage_path).join("|"), [shots]);

  // A signed URL is good for an hour; signing each path once keeps a grid of them from re-signing on
  // every render.
  useEffect(() => {
    let live = true;
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
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  const index = shots.findIndex(x => x.id === openId);
  const open = index >= 0 ? shots[index] : null;
  const captionOf = (shot: Shot) => saved[shot.id] ?? shot.caption ?? "";

  function show(shot: Shot) {
    setOpenId(shot.id);
    setDraft(captionOf(shot));
  }

  function step(by: number) {
    if (!shots.length) return;
    const next = shots[(index + by + shots.length) % shots.length];
    show(next);
  }

  async function saveComment() {
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
    toast.success("Comment saved");
  }

  if (!shots.length) return <div className="empty">No screenshots.</div>;

  return (
    <>
      <div className="shot-grid">
        {shots.map((shot, i) => (
          <figure className="shot-figure" key={shot.id}>
            <button type="button" className="shot-thumb" onClick={() => show(shot)} aria-label={`Open screenshot ${i + 1} of ${shots.length}`}>
              {urls[shot.id]
                ? <img src={urls[shot.id]} alt={captionOf(shot) || "Trade screenshot"} />
                : <span className="muted text-[11px]">Loading image…</span>}
            </button>
            {captionOf(shot)
              ? <figcaption className="shot-caption">{captionOf(shot)}</figcaption>
              : <figcaption className="shot-caption muted">Click to add a comment</figcaption>}
          </figure>
        ))}
      </div>

      {open && (
        <Dialog open onOpenChange={next => { if (!next) setOpenId(null); }}>
          <DialogContent className="dialog-wide" aria-describedby={undefined}>
            <DialogTitle>
              Screenshot {index + 1} of {shots.length}
            </DialogTitle>
            <div className="shot-view">
              {urls[open.id] ? <img src={urls[open.id]} alt={captionOf(open) || "Trade screenshot"} /> : <span className="muted">Loading image…</span>}
            </div>
            <div className="form-field mt-4">
              <Label htmlFor="shot-comment">Comment</Label>
              <Textarea
                id="shot-comment"
                rows={3}
                placeholder="What the chart shows — where you entered, what you saw, what you would do differently."
                value={draft}
                onChange={e => setDraft(e.target.value)}
              />
            </div>
            <DialogFooter className="justify-between">
              <div className="flex items-center gap-2">
                {shots.length > 1 && (
                  <>
                    <Button type="button" variant="secondary" size="sm" onClick={() => step(-1)} aria-label="Previous screenshot">‹</Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => step(1)} aria-label="Next screenshot">›</Button>
                  </>
                )}
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
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" onClick={() => setOpenId(null)}>Close</Button>
                <Button type="button" disabled={saving || draft.trim() === captionOf(open).trim()} onClick={saveComment}>
                  {saving ? "Saving…" : "Save comment"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
