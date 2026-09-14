/**
 * Malaysian (Bursa) trading cost model.
 *
 * Every trade has two legs: the opening contract (entry value) and the closing
 * contract (exit value). Each leg is charged separately, so a round trip pays
 * brokerage, clearing fee, stamp duty and SST twice.
 *
 * Rates are defaults taken from the brokers' published schedules and stay
 * editable in the UI (turn the automatic calculation off to override).
 */

/**
 * The journal records Bursa shares, but the calculator understands the other Bursa classes too
 * (warrants/REITs cap stamp duty at RM200, ETFs are exempt, and `fx` means "no Bursa charges"),
 * so re-adding a selector later is a UI change only.
 */
export type AssetClass = "shares" | "reit_warrant" | "etf" | "fx";

export const SHARES: AssetClass = "shares";

type SstBase = "brokerage" | "platform" | "clearing";

export type BrokerPreset = {
  id: string;
  name: string;
  note: string;
  market: "bursa" | "fx";
  /** brokerage as a fraction (0.0008 = 0.08%) */
  brokerage: {
    rate: number;
    aboveRate: number | null;
    aboveThreshold: number | null;
    min: number;
    intradayRate: number | null;
  };
  platformPerOrder: number;
  clearing: { rate: number; cap: number };
  stamp: { perUnit: number; unit: number; capShares: number; capMarketable: number; exempt: AssetClass[] };
  /** 8% SST applies to "selected asset classes" only — not to ordinary shares. */
  sst: { rate: number; on: SstBase[]; assetClasses: AssetClass[] };
};

const BURSA_CLEARING = { rate: 0.0003, cap: 1000 };
const BURSA_STAMP = {
  perUnit: 1,
  unit: 1000,
  capShares: 1000,
  capMarketable: 200,
  exempt: ["etf", "fx"] as AssetClass[],
};

export const BROKER_PRESETS: BrokerPreset[] = [
  {
    id: "mplus",
    name: "M+ Global (Malacca Securities)",
    note: "0.08% up to RM50k, 0.05% above, min RM8 per order, intraday 0.05%",
    market: "bursa",
    brokerage: { rate: 0.0008, aboveRate: 0.0005, aboveThreshold: 50000, min: 8, intradayRate: 0.0005 },
    platformPerOrder: 0,
    clearing: BURSA_CLEARING,
    stamp: BURSA_STAMP,
    sst: { rate: 0.08, on: ["brokerage"], assetClasses: ["reit_warrant", "etf"] },
  },
  {
    id: "moomoo_my",
    name: "Moomoo Malaysia",
    note: "Commission 0.03% rounded up to 1 sen, RM3 platform fee per order",
    market: "bursa",
    brokerage: { rate: 0.0003, aboveRate: null, aboveThreshold: null, min: 0, intradayRate: null },
    platformPerOrder: 3,
    clearing: BURSA_CLEARING,
    stamp: BURSA_STAMP,
    sst: { rate: 0.08, on: ["brokerage", "platform", "clearing"], assetClasses: ["reit_warrant", "etf"] },
  },
  {
    id: "generic_bursa",
    name: "Other Bursa broker",
    note: "0.08% with an RM8 minimum plus Bursa clearing and stamp duty",
    market: "bursa",
    brokerage: { rate: 0.0008, aboveRate: null, aboveThreshold: null, min: 8, intradayRate: null },
    platformPerOrder: 0,
    clearing: BURSA_CLEARING,
    stamp: BURSA_STAMP,
    sst: { rate: 0.08, on: ["brokerage"], assetClasses: ["reit_warrant", "etf"] },
  },
];

export const DEFAULT_BROKER_ID = "mplus";

export function brokerPreset(id?: string | null): BrokerPreset {
  return BROKER_PRESETS.find(p => p.id === id) ?? BROKER_PRESETS.find(p => p.id === DEFAULT_BROKER_ID)!;
}

export type FeeLeg = {
  contractValue: number;
  brokerage: number;
  platform: number;
  clearing: number;
  stampDuty: number;
  sst: number;
  total: number;
};

export type FeeBreakdown = {
  brokerId: string;
  assetClass: AssetClass;
  intraday: boolean;
  sstRate: number | null;
  open: FeeLeg;
  close: FeeLeg;
  /** brokerage + platform + SST — goes into `trades.commission` */
  brokerCharges: number;
  /** clearing fee + stamp duty — goes into `trades.fees` */
  marketCharges: number;
  total: number;
};

const EMPTY_LEG: FeeLeg = { contractValue: 0, brokerage: 0, platform: 0, clearing: 0, stampDuty: 0, sst: 0, total: 0 };

/** Brokers round fees up to the next sen, so nudge before rounding to avoid float noise. */
const roundUpToCent = (n: number) => Math.ceil((n - 1e-9) * 100) / 100;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function legFees(
  preset: BrokerPreset,
  contractValue: unknown,
  opts: { assetClass?: AssetClass; intraday?: boolean; sstRate?: number | null } = {}
): FeeLeg {
  const value = Number(contractValue);
  const assetClass = opts.assetClass ?? "shares";
  if (!Number.isFinite(value) || value <= 0) return { ...EMPTY_LEG };
  // FX/CFD trades pay no Bursa charges, so leave them for manual entry.
  if (assetClass === "fx" || preset.market === "fx") return { ...EMPTY_LEG, contractValue: round2(value) };

  const { brokerage: b } = preset;
  const intraday = Boolean(opts.intraday && b.intradayRate);
  const rate = intraday
    ? b.intradayRate!
    : b.aboveRate !== null && b.aboveThreshold !== null && value > b.aboveThreshold
      ? b.aboveRate
      : b.rate;

  const brokerage = roundUpToCent(Math.max(value * rate, b.min));
  const platform = roundUpToCent(preset.platformPerOrder);
  const clearing = roundUpToCent(Math.min(value * preset.clearing.rate, preset.clearing.cap));
  const stampCap = assetClass === "reit_warrant" ? preset.stamp.capMarketable : preset.stamp.capShares;
  const stampDuty = preset.stamp.exempt.includes(assetClass)
    ? 0
    : roundUpToCent(Math.min(Math.ceil(value / preset.stamp.unit - 1e-9) * preset.stamp.perUnit, stampCap));
  // SST covers "selected asset classes" only, but a manual rate always wins.
  const sstRate = opts.sstRate ?? (preset.sst.assetClasses.includes(assetClass) ? preset.sst.rate : 0);
  const sstBase =
    (preset.sst.on.includes("brokerage") ? brokerage : 0) +
    (preset.sst.on.includes("platform") ? platform : 0) +
    (preset.sst.on.includes("clearing") ? clearing : 0);
  const sst = roundUpToCent(sstBase * sstRate);

  return {
    contractValue: round2(value),
    brokerage,
    platform,
    clearing,
    stampDuty,
    sst,
    total: round2(brokerage + platform + clearing + stampDuty + sst),
  };
}

export function roundTripFees(
  preset: BrokerPreset,
  entryPrice: unknown,
  exitPrice: unknown,
  quantity: unknown,
  opts: { assetClass?: AssetClass; intraday?: boolean; sstRate?: number | null } = {}
): FeeBreakdown {
  const assetClass = opts.assetClass ?? "shares";
  const intraday = Boolean(opts.intraday);
  const sstRate = opts.sstRate ?? null;
  const qty = Number(quantity);
  const size = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const open = legFees(preset, Number(entryPrice) * size, { assetClass, intraday, sstRate });
  const close = legFees(preset, Number(exitPrice) * size, { assetClass, intraday, sstRate });

  const brokerage = round2(open.brokerage + close.brokerage);
  const platform = round2(open.platform + close.platform);
  const clearing = round2(open.clearing + close.clearing);
  const stampDuty = round2(open.stampDuty + close.stampDuty);
  const sst = round2(open.sst + close.sst);

  return {
    brokerId: preset.id,
    assetClass,
    intraday,
    sstRate,
    open,
    close,
    brokerCharges: round2(brokerage + platform + sst),
    marketCharges: round2(clearing + stampDuty),
    total: round2(open.total + close.total),
  };
}

/** Compact list of the charge components, skipping the zero ones. */
/**
 * Human-readable charge list for one leg, e.g. "brokerage RM 8.00 + clearing RM 0.21". Pass a
 * formatter to control how each figure reads (the UI passes the currency-aware one).
 */
export function describeLeg(leg: FeeLeg, format: (value: number) => string = value => value.toFixed(2)): string {
  const parts = [
    leg.brokerage ? `brokerage ${format(leg.brokerage)}` : "",
    leg.platform ? `platform ${format(leg.platform)}` : "",
    leg.clearing ? `clearing ${format(leg.clearing)}` : "",
    leg.stampDuty ? `stamp ${format(leg.stampDuty)}` : "",
    leg.sst ? `SST ${format(leg.sst)}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" + ") : "no charges";
}
