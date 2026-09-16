"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney, roundMoney } from "@/lib/trading";
import {
  DEFAULT_IPO_DAYS, financedShare, ipoChannel, ipoChannelForBroker, IPO_CHANNELS,
  type IpoCharge, type IpoChannelId, type IpoInputs, type IpoMethod,
} from "@/lib/fees";

/**
 * The subscription as the form holds it: every field is a string, because that is what a text input
 * carries, and a blank financed amount means "the tier's own share of this trade" rather than zero.
 */
export type IpoState = {
  channel: IpoChannelId;
  method: IpoMethod;
  /** The tier picked, as a string for the select; blank on a channel with no tier table. */
  multiple: string;
  financed: string;
  days: string;
};

/** A new application defaults to the subscription route the trade's broker implies, paid for in cash. */
export function defaultIpoState(brokerId?: string | null): IpoState {
  const channel = ipoChannelForBroker(brokerId);
  const tiers = ipoChannel(channel).financing?.leverages ?? [];
  return { channel, method: "cash", multiple: tiers.length ? String(tiers[0].multiple) : "", financed: "", days: String(DEFAULT_IPO_DAYS) };
}

/** What a saved trade recorded, so reopening the form does not price the subscription at cash. */
export function ipoStateFromStored(stored: unknown, brokerId?: string | null): IpoState {
  const base = defaultIpoState(brokerId);
  if (!stored || typeof stored !== "object") return base;
  const s = stored as Partial<IpoInputs>;
  return {
    channel: s.channel && ipoChannel(s.channel).id === s.channel ? s.channel : base.channel,
    method: s.method === "financing" ? "financing" : "cash",
    multiple: s.multiple === null || s.multiple === undefined ? "" : String(s.multiple),
    financed: s.financed === null || s.financed === undefined ? "" : String(s.financed),
    days: s.days === null || s.days === undefined ? base.days : String(s.days),
  };
}

/** The priced inputs behind the state. A blank amount falls back to the tier's share of the trade. */
export function ipoInputs(state: IpoState, contractValue: number): IpoInputs {
  const multiple = state.multiple === "" ? null : Number(state.multiple);
  const share = multiple === null ? 0 : financedShare(multiple);
  const entered = state.financed.trim() === "" ? roundMoney(contractValue * share) : Number(state.financed);
  const days = state.days.trim() === "" ? 0 : Number(state.days);
  return {
    channel: state.channel,
    method: state.method,
    multiple,
    financed: Number.isFinite(entered) ? entered : 0,
    days: Number.isFinite(days) ? days : 0,
  };
}

/**
 * The subscription fields. They only appear on a trade flagged as an IPO allocation, because that is
 * the only trade whose opening leg is an application rather than a market buy.
 */
export function IpoSubscription({ state, onChange, charge, contractValue, currency, idPrefix }: {
  state: IpoState;
  onChange: (next: IpoState) => void;
  charge: IpoCharge;
  /** This trade's entry value, used to default what the tier borrows. */
  contractValue: number;
  currency?: string | null;
  idPrefix: string;
}) {
  const preset = ipoChannel(state.channel);
  const financing = preset.financing;
  const tiers = financing?.leverages ?? [];
  const tier = tiers.find(t => String(t.multiple) === state.multiple) ?? null;
  const set = (patch: Partial<IpoState>) => onChange({ ...state, ...patch });
  const money = (v: number) => formatMoney(v, currency);
  const borrowing = state.method === "financing" && financing !== null;
  const derivedFinanced = tier ? roundMoney(contractValue * financedShare(tier.multiple)) : 0;
  const days = Number(state.days) || 0;
  const ratePct = charge.rate === null ? "" : String(+(charge.rate * 100).toFixed(2));

  return (
    <div className="ipo-block">
      <div className="ipo-head">
        <b>IPO subscription</b>
        <span className="muted text-[11px]">{preset.note}</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="form-field flex-[1_1_190px]">
          <Label htmlFor={`${idPrefix}-ipo-channel`}>Application channel</Label>
          <Select value={state.channel} onValueChange={v => {
            const next = ipoChannel(v);
            const nextTiers = next.financing?.leverages ?? [];
            // A channel that lends nothing cannot be asked for financing, and its own tiers replace
            // the previous channel's rather than leaving a tier that does not exist there.
            onChange({
              ...state,
              channel: next.id,
              method: next.financing ? state.method : "cash",
              multiple: nextTiers.length ? String(nextTiers[0].multiple) : "",
            });
          }}>
            <SelectTrigger id={`${idPrefix}-ipo-channel`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {IPO_CHANNELS.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {financing ? (
          <div className="form-field flex-[0_1_170px]">
            <Label htmlFor={`${idPrefix}-ipo-method`}>Funding</Label>
            <Select value={state.method} onValueChange={v => set({ method: v as IpoMethod })}>
              <SelectTrigger id={`${idPrefix}-ipo-method`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="financing">Financing</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {borrowing && tiers.length ? (
          <div className="form-field flex-[0_1_190px]">
            <Label htmlFor={`${idPrefix}-ipo-tier`}>Financing tier</Label>
            <Select value={state.multiple} onValueChange={v => set({ multiple: v })}>
              <SelectTrigger id={`${idPrefix}-ipo-tier`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {tiers.map(t => <SelectItem key={t.multiple} value={String(t.multiple)}>{t.multiple}x — {Math.round(financedShare(t.multiple) * 100)}% financed</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {borrowing ? (
          <div className="form-field flex-[0_1_170px]">
            <Label htmlFor={`${idPrefix}-ipo-financed`}>Financed amount</Label>
            <Input
              id={`${idPrefix}-ipo-financed`}
              type="number"
              step="any"
              min="0"
              value={state.financed}
              onChange={e => set({ financed: e.target.value })}
              placeholder={derivedFinanced ? derivedFinanced.toFixed(2) : "0.00"}
            />
          </div>
        ) : null}
        {borrowing ? (
          <div className="form-field flex-[0_1_110px]">
            <Label htmlFor={`${idPrefix}-ipo-days`}>Days</Label>
            <Input id={`${idPrefix}-ipo-days`} type="number" step="1" min="0" value={state.days} onChange={e => set({ days: e.target.value })} />
          </div>
        ) : null}
      </div>
      <div className="muted text-[10px] mt-2">
        {charge.method === "financing" && charge.rate !== null ? (
          <>
            {charge.multiple ? `${charge.multiple}x finances ` : "Financing "}
            <b>{money(charge.financed)}</b> at {ratePct}% p.a. ÷ 365 × {days} day{days === 1 ? "" : "s"} = <b>{money(charge.financingFee)}</b>
            {charge.financingSst ? <> plus SST <b>{money(charge.financingSst)}</b></> : null}
            {charge.applicationFee ? <>, plus the {money(charge.applicationFee)} application fee and its SST <b>{money(charge.applicationSst)}</b></> : null}
            . {financing?.note}
          </>
        ) : (
          <>
            {charge.applicationFee
              ? <>Application fee {money(charge.applicationFee)} plus {money(charge.applicationSst)} SST — <b>{money(charge.total)}</b>, non-refundable. </>
              : <>Free application. </>}
            No brokerage, clearing fee or stamp duty is charged on the subscription itself, because no
            shares changed hands on the exchange — only the sell side is a market trade.
          </>
        )}
      </div>
      {borrowing && tier ? (
        <div className="muted text-[10px] mt-1">
          {tier.multiple}x asks for {money(tier.minDeposit ?? 0)} in the trust account and an application of at least {money(tier.minApplication ?? 0)};
          leave the amount blank to use {Math.round(financedShare(tier.multiple) * 100)}% of this trade&apos;s {money(contractValue)} contract value.
        </div>
      ) : null}
      {borrowing && !tier ? (
        <div className="muted text-[10px] mt-1">
          Enter the amount you borrowed and the days it was out; with no amount entered the subscription is priced as cash.
        </div>
      ) : null}
    </div>
  );
}
