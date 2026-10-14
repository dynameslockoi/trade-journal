"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { BURSA_SECTORS, isSubSectorOf, SECTOR_UNSET, stripUnknownColumn, subSectorsFor, type Trade } from "@/lib/trading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SELECT_NONE } from "@/components/ui/select";

/**
 * Bursa's classification of a stock — the sector, and the sub-sector under it — applied to a symbol
 * rather than to a trade.
 *
 * Both are really properties of the stock, but they are stored per trade so there is one source of
 * truth. That makes this the useful other half of the two fields on the trade form: classify a symbol
 * once here and it lands on every trade of it, including the ones recorded before the columns existed.
 *
 * A sector change also decides the sub-sector's fate. A sub-sector under the wrong sector is not a
 * classification the exchange has, so one that no longer belongs to the chosen sector is cleared
 * rather than left to contradict the field beside it — and one that does belong is kept, so
 * re-picking the same sector is not a way to lose it.
 *
 * The symbols and counts come from the trades already loaded by the journal, so this asks the
 * database for nothing until something is actually changed.
 */
export function SectorManager({ trades, onSaved }: { trades: Trade[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");

  // One row per symbol, carrying the classification of its most recent trade that has a sector.
  const symbols = useMemo(() => {
    const map: Record<string, { symbol: string; count: number; sector: string; sub: string; at: string }> = {};
    for (const t of trades) {
      const sym = String(t.symbol || "").toUpperCase();
      if (!sym) continue;
      const row = (map[sym] ??= { symbol: sym, count: 0, sector: "", sub: "", at: "" });
      row.count++;
      const at = String(t.entry_at || "");
      if (t.sector && at >= row.at) { row.sector = t.sector; row.sub = t.sub_sector || ""; row.at = at; }
    }
    return Object.values(map).sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));
  }, [trades]);

  const unclassified = symbols.filter(s => !s.sector || !s.sub).length;
  const shown = search.trim()
    ? symbols.filter(s => s.symbol.toLowerCase().includes(search.trim().toLowerCase()))
    : symbols;

  /**
   * One update lands on every trade of the symbol — that is the point of classifying by symbol.
   *
   * The write carries the sub-sector where it has one, and where the database predates
   * `supabase/subsectors.sql` the sector half is still worth keeping: `stripUnknownColumn` drops the
   * column PostgREST named and the update is retried, the same way the trade forms save a trade.
   */
  async function write(symbol: string, payload: Record<string, string | null>, label: string) {
    setBusy(symbol);
    const s = createClient();
    const { data: { user } } = await s.auth.getUser();
    if (!user) { toast.error("Please sign in again."); setBusy(""); return; }
    const run = (body: Record<string, string | null>) =>
      s.from("trades").update(body).eq("user_id", user.id).eq("symbol", symbol);
    let res = await run(payload);
    if (res.error?.code === "PGRST204") {
      const retry = stripUnknownColumn(payload, res.error.message);
      // Nothing left to write means the only field being changed is the one the database lacks.
      if (!Object.keys(retry).length) {
        setBusy("");
        toast.error("Run supabase/subsectors.sql before recording sub-sectors.");
        return;
      }
      res = await run(retry);
    }
    setBusy("");
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(label);
    onSaved();
  }

  function assignSector(s: { symbol: string; sub: string }, value: string) {
    const sector = value === SELECT_NONE ? null : value;
    const sub = isSubSectorOf(sector, s.sub) ? s.sub : null;
    void write(s.symbol, { sector, sub_sector: sub }, sector ? `${s.symbol} → ${sector}` : `${s.symbol} sector cleared`);
  }

  function assignSubSector(symbol: string, value: string) {
    const sub = value === SELECT_NONE ? null : value;
    void write(symbol, { sub_sector: sub }, sub ? `${symbol} · ${sub}` : `${symbol} sub-sector cleared`);
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Classification{unclassified ? ` · ${unclassified} unset` : ""}
      </Button>

      {open && (
        <Dialog open onOpenChange={next => { if (!next) { setOpen(false); setSearch(""); } }}>
          <DialogContent className="dialog-wide" aria-describedby={undefined}>
            <DialogTitle>Bursa sector and sub-sector, by symbol</DialogTitle>
            <p className="muted text-[11.5px] mt-1 mb-3">
              Both belong to the stock, so setting them here applies to <b>every trade</b> of that
              symbol. {unclassified
                ? `${unclassified} of ${symbols.length} symbols are missing one or the other.`
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
                      {s.sector ? "" : ` · sector ${SECTOR_UNSET}`}
                      {s.sector && !s.sub ? ` · sub-sector ${SECTOR_UNSET}` : ""}
                    </span>
                  </div>
                  <div className="sector-row-fields">
                    <Select
                      value={s.sector || SELECT_NONE}
                      onValueChange={v => assignSector(s, v)}
                      disabled={busy === s.symbol}
                    >
                      <SelectTrigger aria-label={`Sector for ${s.symbol}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SELECT_NONE}>{SECTOR_UNSET}</SelectItem>
                        {BURSA_SECTORS.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {/* Follows the sector above it: a sub-sector is only meaningful inside its own. */}
                    <Select
                      value={s.sub || SELECT_NONE}
                      onValueChange={v => assignSubSector(s.symbol, v)}
                      disabled={busy === s.symbol || !subSectorsFor(s.sector).length}
                    >
                      <SelectTrigger aria-label={`Sub-sector for ${s.symbol}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SELECT_NONE}>{SECTOR_UNSET}</SelectItem>
                        {subSectorsFor(s.sector).map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
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
