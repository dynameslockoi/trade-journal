"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { BURSA_SECTORS, SECTOR_UNSET, type Trade } from "@/lib/trading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SELECT_NONE } from "@/components/ui/select";

/**
 * A sector belongs to the stock, not the trade — but it is stored per trade so there is one source of
 * truth. That makes this the useful other half of the field: assign a sector once per symbol and it
 * lands on every trade of it, including the ones recorded before the column existed.
 *
 * The symbols and counts come from the trades already loaded by the journal, so this asks the
 * database for nothing until something is actually changed.
 */
export function SectorManager({ trades, onSaved }: { trades: Trade[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");

  // One row per symbol, carrying the sector of its most recent trade that has one.
  const symbols = useMemo(() => {
    const map: Record<string, { symbol: string; count: number; sector: string; at: string }> = {};
    for (const t of trades) {
      const sym = String(t.symbol || "").toUpperCase();
      if (!sym) continue;
      const row = (map[sym] ??= { symbol: sym, count: 0, sector: "", at: "" });
      row.count++;
      const at = String(t.entry_at || "");
      if (t.sector && at >= row.at) { row.sector = t.sector; row.at = at; }
    }
    return Object.values(map).sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));
  }, [trades]);

  const unassigned = symbols.filter(s => !s.sector).length;
  const shown = search.trim()
    ? symbols.filter(s => s.symbol.toLowerCase().includes(search.trim().toLowerCase()))
    : symbols;

  async function assign(symbol: string, value: string) {
    const sector = value === SELECT_NONE ? null : value;
    setBusy(symbol);
    const s = createClient();
    const { data: { user } } = await s.auth.getUser();
    if (!user) { toast.error("Please sign in again."); setBusy(""); return; }
    // Every trade of the symbol, not just the newest: the point is to fill in what is already there.
    const { error } = await s.from("trades").update({ sector }).eq("user_id", user.id).eq("symbol", symbol);
    setBusy("");
    if (error) { toast.error(error.message); return; }
    toast.success(sector ? `${symbol} → ${sector}` : `${symbol} sector cleared`);
    onSaved();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Sectors{unassigned ? ` · ${unassigned} unset` : ""}
      </Button>

      {open && (
        <Dialog open onOpenChange={next => { if (!next) { setOpen(false); setSearch(""); } }}>
          <DialogContent className="dialog-wide" aria-describedby={undefined}>
            <DialogTitle>Bursa sector by symbol</DialogTitle>
            <p className="muted text-[11.5px] mt-1 mb-3">
              A sector belongs to the stock, so setting it here applies to <b>every trade</b> of that
              symbol. {unassigned
                ? `${unassigned} of ${symbols.length} symbols still have none.`
                : `All ${symbols.length} symbols are classified.`}
            </p>
            <div className="form-field mb-3">
              <Label htmlFor="sec-search">Find a symbol</Label>
              <Input id="sec-search" value={search} placeholder="e.g. SUNMED" onChange={e => setSearch(e.target.value)} />
            </div>

            <div className="sector-list">
              {shown.map(s => (
                <div className="sector-row" key={s.symbol}>
                  <div className="sector-row-head">
                    <b>{s.symbol}</b>
                    <span className="muted text-[10px]">
                      {s.count} trade{s.count === 1 ? "" : "s"}
                      {s.sector ? "" : ` · ${SECTOR_UNSET}`}
                    </span>
                  </div>
                  <Select
                    value={s.sector || SELECT_NONE}
                    onValueChange={v => assign(s.symbol, v)}
                    disabled={busy === s.symbol}
                  >
                    <SelectTrigger aria-label={`Sector for ${s.symbol}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_NONE}>{SECTOR_UNSET}</SelectItem>
                      {BURSA_SECTORS.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {!shown.length && <Card><CardContent className="empty">No symbol matches that.</CardContent></Card>}
            </div>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => { setOpen(false); setSearch(""); }}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
