"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SESSIONS, sessionLabel } from "@/lib/trading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SELECT_NONE,
} from "@/components/ui/select";

export type Filters = { account: string; symbol: string; strategy: string; session: string; result: string; ipo: string; from: string; to: string; tag: string };
export const emptyFilters: Filters = { account: "", symbol: "", strategy: "", session: "", result: "", ipo: "", from: "", to: "", tag: "" };

/** Radix refuses an empty item value, so every "any" choice travels through the sentinel. */
const toValue = (v: string) => v || SELECT_NONE;
const fromValue = (v: string) => (v === SELECT_NONE ? "" : v);

export function FilterBar({ filters, setFilters, accounts, strategies, tags }: { filters: Filters; setFilters: Dispatch<SetStateAction<Filters>>; accounts: any[]; strategies: any[]; tags: any[] }) {
  // Starts closed: filters are something you reach for, not something that pushes the data down.
  const [open, setOpen] = useState(false);
  const active = Object.values(filters).filter(v => v !== "").length;
  const upd = (k: keyof Filters, v: string) => setFilters(prev => ({ ...prev, [k]: v }));

  return (
    <Card className="filter-card">
      <CardContent>
        {/* One collapsible owns both the toggle and the fields, so the state lives in one place. */}
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="filter-head">
            <div>
              <b>Filters</b>
              <div className="muted filter-hint">{active ? `${active} active` : "Refine the data without changing your journal."}</div>
            </div>
            <div className="filter-actions">
              <CollapsibleTrigger asChild>
                <Button variant="secondary" type="button" aria-controls="filter-fields">
                  {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  {open ? "Hide" : "Show"}
                </Button>
              </CollapsibleTrigger>
              <Button variant="secondary" type="button" disabled={!active} onClick={() => setFilters({ ...emptyFilters })}>
                Reset
              </Button>
            </div>
          </div>
          <CollapsibleContent>
            <div className="grid four filter-grid" id="filter-fields">
              <div className="form-field">
                <Label htmlFor="flt-account">Account</Label>
                <Select value={toValue(filters.account)} onValueChange={v => upd("account", fromValue(v))}>
                  <SelectTrigger id="flt-account"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>All accounts</SelectItem>
                    {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="form-field">
                <Label htmlFor="flt-strategy">Strategy</Label>
                <Select value={toValue(filters.strategy)} onValueChange={v => upd("strategy", fromValue(v))}>
                  <SelectTrigger id="flt-strategy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>All strategies</SelectItem>
                    {strategies.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="form-field">
                <Label htmlFor="flt-symbol">Symbol</Label>
                <Input id="flt-symbol" value={filters.symbol} placeholder="e.g. GTA" onChange={e => upd("symbol", e.target.value)} />
              </div>

              <div className="form-field">
                <Label htmlFor="flt-session">Session</Label>
                <Select value={toValue(filters.session)} onValueChange={v => upd("session", fromValue(v))}>
                  <SelectTrigger id="flt-session"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>All sessions</SelectItem>
                    {SESSIONS.map(x => <SelectItem key={x} value={x}>{sessionLabel(x)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="form-field">
                <Label htmlFor="flt-result">Result</Label>
                <Select value={toValue(filters.result)} onValueChange={v => upd("result", fromValue(v))}>
                  <SelectTrigger id="flt-result"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>All results</SelectItem>
                    <SelectItem value="win">Wins</SelectItem>
                    <SelectItem value="loss">Losses</SelectItem>
                    <SelectItem value="breakeven">Breakeven</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="form-field">
                <Label htmlFor="flt-ipo">Entry</Label>
                <Select value={toValue(filters.ipo)} onValueChange={v => upd("ipo", fromValue(v))}>
                  <SelectTrigger id="flt-ipo"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>All entries</SelectItem>
                    <SelectItem value="ipo">IPO allocation</SelectItem>
                    <SelectItem value="market">Market buy</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="form-field">
                <Label htmlFor="flt-tag">Tag</Label>
                <Select value={toValue(filters.tag)} onValueChange={v => upd("tag", fromValue(v))}>
                  <SelectTrigger id="flt-tag"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>All tags</SelectItem>
                    {tags.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="form-field">
                <Label htmlFor="flt-from">From</Label>
                <DatePicker id="flt-from" value={filters.from} onChange={v => upd("from", v)} placeholder="Any date" />
              </div>

              <div className="form-field">
                <Label htmlFor="flt-to">To</Label>
                <DatePicker id="flt-to" value={filters.to} onChange={v => upd("to", v)} placeholder="Any date" />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export function applyFilters(ts: any[], f: Filters) { return ts.filter(t => { const pnl = Number(t.net_pnl || 0); if (f.account && t.account_id !== f.account) return false; if (f.strategy && t.strategy_id !== f.strategy) return false; if (f.session && t.session !== f.session) return false; if (f.result === "win" && pnl <= 0) return false; if (f.result === "loss" && pnl >= 0) return false; if (f.result === "breakeven" && pnl !== 0) return false; if (f.ipo === "ipo" && !t.is_ipo) return false; if (f.ipo === "market" && t.is_ipo) return false; if (f.symbol && !String(t.symbol || "").toLowerCase().includes(f.symbol.trim().toLowerCase())) return false; if (f.from && new Date(t.entry_at) < new Date(`${f.from}T00:00:00`)) return false; if (f.to && new Date(t.entry_at) > new Date(`${f.to}T23:59:59.999`)) return false; if (f.tag && !(t.trade_tags || []).some((x: any) => x.tag_id === f.tag)) return false; return true }) }
