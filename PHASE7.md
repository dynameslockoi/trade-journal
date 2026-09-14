# Trading Journal Pro — Phase 7

Phase 7 turns the journal from an FX/CFD-style ledger into a **Bursa Malaysia stock journal**
with automatic P&L and automatic Malaysian broker fees.

## Automatic calculations

Every trade now derives its money numbers instead of asking you to work them out:

- **Gross P&L** = `(exit − entry) × shares`, inverted for shorts.
- **Commission** = brokerage + platform fee + SST (the broker's side).
- **Exchange fees** = clearing fee + stamp duty (Bursa + government).
- **Net P&L** = gross − commission − exchange fees − swap (the `net_pnl` generated column).
- **R multiple** is now stored from **net** P&L, so it reflects what you actually kept. The form
  shows both `R (net)` and `R (gross)`.

A total of 39 money checks cover the model; run them with:

```bash
npm run test:fees
```

## Broker fee presets

| | M+ Global (Malacca Securities) | Moomoo Malaysia | Other Bursa broker |
|---|---|---|---|
| Brokerage | 0.08% up to RM50k, 0.05% above, **min RM8**, intraday 0.05% | 0.03%, rounded up to 1 sen | 0.08%, min RM8 |

M+ is a single preset. Its rate table publishes an *online* rate of 0.08% up to RM50,000 and 0.05%
above, so up to RM50,000 the calculation is identical to the flat "0.08% or minimum RM8" quoted in
older guides such as iSaham's. If a future contract note above RM50,000 still shows 0.08%, switch
the **Auto-calculate** toggle off on that trade and type the commission from the note.

The brokerage rate is cross-checked against both sources: the RM8 minimum on a RM8,000 contract,
and iSaham's RM64.00 on RM80,000 is what a flat 0.08% would give (the current tiered rate charges
RM40.00 there). Clearing fee and stamp duty reproduce iSaham's examples exactly.
| Platform fee | — | RM3 per order | — |
| Clearing fee | 0.03% (cap RM1,000) | 0.03% (cap RM1,000) | 0.03% (cap RM1,000) |
| Stamp duty | RM1 per RM1,000 or part | same | same |
| SST | 8% on brokerage¹ | 8% on brokerage + platform + clearing¹ | 8% on brokerage¹ |

¹ SST applies to *selected asset classes* only — warrants, structured warrants, ETFs, REITs and
similar. Plain shares are not charged SST in the published examples (and the 2022 budget removed
the tax on share brokerage outright), which is why the calculator applies 0% to shares by default.
Use the **SST %** box on the trade form to force it on if your contract note shows otherwise.

Bursa's own schedule is reflected too: stamp duty is RM1 per RM1,000 of contract value *or
fractional part*, capped at RM1,000 for shares and RM200 for warrants/rights/REITs. Note that M+
does not publish an intraday rate for ETFs, and the ETF stamp-duty exemption has been extended
several times — the calculator treats Bursa-listed ETFs as exempt, matching the brokers' current
pages (until 31 Dec 2028).

Asset class also changes stamp duty: shares cap at RM1,000, REITs/warrants at RM200, Bursa-listed
ETFs are exempt (until 31 Dec 2028), and FX/CFD trades pay no Bursa charges at all. This journal
records **shares only**, so the form no longer shows an asset-class selector — it always prices
stamp duty at the RM1,000 cap with no SST on brokerage. The calculator still understands the other
classes, so restoring the selector is a UI change only.

Every trade is charged **two legs** — the opening contract and the closing contract — so a round
trip pays the RM8 minimum twice. On the sample trade in the README (2,000 shares, 0.35 → 0.40):

```
gross +100.00   charges 18.45   net +81.55   R (net) 4.08R with a RM20 risk
```

## Stock-trading adaptations

- Bursa **board lots**: a `Board Lots ×100` helper fills in the share quantity.
- Trades are recorded as Bursa shares; the shares-only form hides the FX `Swap` field (an edited
trade that already carries a swap value still shows it, so nothing is lost).
- Broker is stored per account (`trading_accounts.broker`) and pre-selects the preset on the form.
- The trade detail page shows contract values, gross/net P&L, total charges and the stored
  per-leg breakdown (brokerage, platform, clearing, stamp duty, SST).
- Sessions were reduced to the two Bursa windows in Phase 8 (see `PHASE8.md`),
  accounts default to **MYR**, and the settings page defaults to MYR too.
- `Swap` is labelled as an FX-only field.

### Optional

The database migration for the two new columns is idempotent. The app keeps working without it —
it saves the trade and simply drops the breakdown — but the broker dropdown and the stored
breakdown need it:

```sql
alter table public.trading_accounts add column if not exists broker text;
alter table public.trades add column if not exists fee_breakdown jsonb;
```

## Verification

```bash
npm run test:fees    # 39 money checks, including the published M+ RM22.99 example
npm run typecheck
npm run build
```

`scripts/fee-check.mts` runs on Node 22.6+ (native TypeScript type stripping).
