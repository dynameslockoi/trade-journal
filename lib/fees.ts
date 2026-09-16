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

/* ============================================================== IPO subscriptions
   An IPO application is not a market buy, so its opening leg is priced by the channel that took the
   application rather than by the brokerage schedule: M+ Global and Moomoo charge nothing for a cash
   application, Maybank charges RM1 plus SST, and borrowing to apply adds an interest charge over the
   days the money is out. The sell side is an ordinary market sell, so it keeps the broker preset. */

export type IpoChannelId = "mplus" | "moomoo" | "maybank";
export type IpoMethod = "cash" | "financing";

/** One multiple a channel finances, with the balance it asks you to hold first. */
export type IpoLeverage = { multiple: number; minDeposit: number | null; minApplication: number | null };

export type IpoChannel = {
  id: IpoChannelId;
  name: string;
  note: string;
  /** Charged once per application and not refunded. Maybank's RM1; free everywhere else. */
  applicationFee: number;
  /** SST on that fee, as a fraction of it. */
  applicationSstRate: number;
  /** Borrowing, when the channel offers it in its own app. `null` means a cash application only. */
  financing: {
    /** Annual rate as a fraction — 0.08 is 8% p.a. */
    rate: number;
    sstRate: number;
    note: string;
    /** An empty list means the channel publishes no tier table, so the amount is entered by hand. */
    leverages: IpoLeverage[];
  } | null;
};

/**
 * Published rates as at September 2026. M+ financing is the tiered one (2x is 50:50, 5x is 20:80,
 * 10x is 10:90) charged at 8% p.a. over the interest-bearing days plus SST, refunded when no
 * allocation is received. Moomoo asks nothing for the application but charges financing interest at
 * 6.8% p.a., calculated daily. Maybank's eShare application is RM1 per IPO with 8% SST on it.
 */
export const IPO_CHANNELS: IpoChannel[] = [
  {
    id: "mplus",
    name: "M+ Global",
    note: "Free on a cash application. Financing is 8% p.a. over the interest-bearing days, plus SST, and is refunded if you are not allotted.",
    applicationFee: 0,
    applicationSstRate: 0.08,
    financing: {
      rate: 0.08,
      sstRate: 0.08,
      note: "Charged on the financed amount for the interest-bearing days, so it is settled and refunded with the application.",
      leverages: [
        { multiple: 2, minDeposit: 10000, minApplication: 20000 },
        { multiple: 5, minDeposit: 20000, minApplication: 100000 },
        { multiple: 10, minDeposit: 50000, minApplication: 500000 },
      ],
    },
  },
  {
    id: "moomoo",
    name: "Moomoo Malaysia",
    note: "No application fee and no CDS fee. Financing interest is 6.8% p.a., charged daily.",
    applicationFee: 0,
    applicationSstRate: 0,
    financing: {
      rate: 0.068,
      sstRate: 0,
      note: "Moomoo publishes no tier table for IPO financing — enter the amount borrowed and the days to include the interest.",
      leverages: [],
    },
  },
  {
    id: "maybank",
    name: "Maybank eShare",
    note: "RM1 per application plus 8% SST (RM1.08), non-refundable. Cash applications only.",
    applicationFee: 1,
    applicationSstRate: 0.08,
    financing: null,
  },
];

export const DEFAULT_IPO_CHANNEL: IpoChannelId = "mplus";

/** What an IPO financing application is assumed to be outstanding for, until you say otherwise. */
export const DEFAULT_IPO_DAYS = 7;

export function ipoChannel(id?: string | null): IpoChannel {
  return IPO_CHANNELS.find(c => c.id === id) ?? IPO_CHANNELS.find(c => c.id === DEFAULT_IPO_CHANNEL)!;
}

/**
 * The subscription route a trading broker implies: subscribing through M+ Global or Moomoo means the
 * journal already knows which application channel to default to.
 */
export function ipoChannelForBroker(brokerId?: string | null): IpoChannelId {
  if (brokerId === "moomoo_my") return "moomoo";
  if (brokerId === "mplus") return "mplus";
  return DEFAULT_IPO_CHANNEL;
}

/**
 * What each multiple borrows, as a share of the application: 2x is half, 5x is four fifths, 10x is
 * nine tenths. Deriving it keeps the tiers honest with the ratio the broker publishes.
 */
export function financedShare(multiple: number): number {
  if (!Number.isFinite(multiple) || multiple <= 1) return 0;
  return +(1 - 1 / multiple).toFixed(4);
}

/** The inputs the form keeps: the route, and what was borrowed for how long. */
export type IpoInputs = {
  channel: IpoChannelId;
  method: IpoMethod;
  /** The multiple picked, or null for a channel without a tier table. */
  multiple: number | null;
  /** The amount borrowed. Zero means a cash application whatever the method says. */
  financed: number;
  /** Interest-bearing days the financing is charged over. */
  days: number;
};

/** The subscription charge, both as the inputs and as the money they add up to. */
export type IpoCharge = IpoInputs & {
  channelName: string;
  /** Annual rate actually applied, or null on a cash application. */
  rate: number | null;
  applicationFee: number;
  applicationSst: number;
  financingFee: number;
  financingSst: number;
  total: number;
};

const asMoney = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/**
 * Price one IPO application. A cash application costs the channel's flat fee (free on M+ and
 * Moomoo, RM1.08 on Maybank) and nothing else — no brokerage, clearing or stamp duty, because no
 * shares changed hands on the exchange. Borrowing adds interest at the channel's annual rate over
 * the interest-bearing days, and its SST where one applies.
 */
export function ipoCharge(inputs: IpoInputs): IpoCharge {
  const channel = ipoChannel(inputs.channel);
  const applicationFee = round2(asMoney(channel.applicationFee));
  const applicationSst = roundUpToCent(applicationFee * channel.applicationSstRate);

  const borrowing = channel.financing;
  const financed = asMoney(inputs.financed);
  const days = asMoney(inputs.days);
  const borrowingUsed = inputs.method === "financing" && borrowing !== null && financed > 0 && days > 0;
  const financingFee = borrowingUsed ? roundUpToCent(financed * borrowing!.rate / 365 * days) : 0;
  const financingSst = borrowingUsed ? roundUpToCent(financingFee * borrowing!.sstRate) : 0;

  return {
    ...inputs,
    // A cash application has no rate to report, even when the channel's does exist.
    method: borrowingUsed ? "financing" : "cash",
    channelName: channel.name,
    rate: borrowingUsed ? borrowing!.rate : null,
    applicationFee,
    applicationSst,
    financingFee,
    financingSst,
    total: round2(applicationFee + applicationSst + financingFee + financingSst),
  };
}

/** Human-readable subscription charge for the fee panel. */
export function describeIpo(charge: IpoCharge, format: (value: number) => string = value => value.toFixed(2)): string {
  const parts = [
    charge.applicationFee ? `application ${format(charge.applicationFee)}` : "",
    charge.applicationSst ? `SST ${format(charge.applicationSst)}` : "",
    charge.financingFee ? `financing ${format(charge.financingFee)}` : "",
    charge.financingSst ? `SST on financing ${format(charge.financingSst)}` : "",
  ].filter(Boolean);
  if (parts.length) return parts.join(" + ");
  return "free";
}

/** The subscription line's own label: who took the application and how it was funded. */
export function ipoTitle(charge: IpoCharge): string {
  if (charge.method === "financing" && charge.multiple) return `${charge.channelName} · ${charge.multiple}x`;
  if (charge.method === "financing") return `${charge.channelName} · financed`;
  return `${charge.channelName} · cash`;
}

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
  /** The subscription, on a trade that came from an IPO application — null on a market buy. */
  ipo: IpoCharge | null;
  /** brokerage + platform + SST + the subscription — goes into `trades.commission` */
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
  opts: { assetClass?: AssetClass; intraday?: boolean; sstRate?: number | null; ipo?: IpoInputs | null } = {}
): FeeBreakdown {
  const assetClass = opts.assetClass ?? "shares";
  const intraday = Boolean(opts.intraday);
  const sstRate = opts.sstRate ?? null;
  const qty = Number(quantity);
  const size = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const entryValue = Number(entryPrice) * size;
  // An IPO application is priced by its channel, not by the brokerage schedule, so the opening leg
  // carries the contract value for reference and no market charges at all.
  const ipo = opts.ipo ? ipoCharge(opts.ipo) : null;
  const open = ipo
    ? { ...EMPTY_LEG, contractValue: round2(Number.isFinite(entryValue) && entryValue > 0 ? entryValue : 0) }
    : legFees(preset, entryValue, { assetClass, intraday, sstRate });
  const close = legFees(preset, Number(exitPrice) * size, { assetClass, intraday, sstRate });

  const brokerage = round2(open.brokerage + close.brokerage);
  const platform = round2(open.platform + close.platform);
  const clearing = round2(open.clearing + close.clearing);
  const stampDuty = round2(open.stampDuty + close.stampDuty);
  const sst = round2(open.sst + close.sst);
  const subscribe = round2(ipo?.total ?? 0);

  return {
    brokerId: preset.id,
    assetClass,
    intraday,
    sstRate,
    open,
    close,
    ipo,
    // The subscription is a broker-side charge, so it sits with the commission rather than with the
    // clearing and stamp duty that only a real market trade pays.
    brokerCharges: round2(brokerage + platform + sst + subscribe),
    marketCharges: round2(clearing + stampDuty),
    total: round2(open.total + close.total + subscribe),
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
