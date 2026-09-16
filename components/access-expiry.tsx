"use client";

import { useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { AccessNotice } from "@/lib/access";

/**
 * The band that tells a customer their access is running out — while they can still do something
 * about it.
 *
 * The blocked screen only exists once access is gone, which is the worst moment to mention a date: the
 * customer is already locked out, and the only thing they can do is email. This appears while the
 * journal still works, so the last two weeks are a countdown rather than a surprise.
 *
 * Two rules keep it from becoming wallpaper: an account with more than a fortnight left gets nothing
 * here (only its settings page mentions the date), and the band can be dismissed. The dismissal is
 * component state, so it lasts for the session and comes back on the next reload — enough to get it out
 * of the way while reading a page, not enough to forget about the date.
 *
 * Only `due-soon` is drawn. `scheduled` is too far off to nag about, and `expired` cannot happen here:
 * the shell stops an expired account at the blocked screen before this ever renders.
 */
export function AccessExpiry({ notice }: { notice: AccessNotice | null }) {
  const [dismissed, setDismissed] = useState(false);
  if (!notice || notice.key !== "due-soon" || dismissed) return null;
  return (
    // The wrapper is the component's, not the shell's: when there is nothing to show — most of the
    // time — it has to leave no band of empty space above the page either.
    <div className="expiry-wrap">
      <Alert variant="warn" className="expiry-band">
        <div className="expiry-copy">
          <AlertTitle className="expiry-title">
            <CalendarClock size={13} aria-hidden />
            {notice.label}
          </AlertTitle>
          <AlertDescription>{notice.detail}</AlertDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="expiry-dismiss"
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss this notice"
          title="Hide until the next reload"
        >
          <X size={14} />
        </Button>
      </Alert>
    </div>
  );
}
