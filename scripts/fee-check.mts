import { brokerPreset, legFees, roundTripFees } from "../lib/fees.ts";

const mplus = brokerPreset("mplus");
const moomoo = brokerPreset("moomoo_my");
const generic = brokerPreset("generic_bursa");

const money = (n: number) => n.toFixed(2);
let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual} expected ${expected}`);
}

// 1. Published M+ example: 20,000 units @ RM0.545 = RM10,900 -> total fee RM22.99
const mplusExample = legFees(mplus, 20000 * 0.545);
check("M+ brokerage on RM10,900", money(mplusExample.brokerage), "8.72");
check("M+ clearing on RM10,900", money(mplusExample.clearing), "3.27");
check("M+ stamp duty on RM10,900", money(mplusExample.stampDuty), "11.00");
check("M+ total on RM10,900", money(mplusExample.total), "22.99");

// 2. User's GTA trade: 2,000 shares, entry 0.35, exit 0.40 (M+, RM8 minimum)
const gta = roundTripFees(mplus, 0.35, 0.4, 2000, { assetClass: "shares" });
check("GTA open brokerage (min applies)", money(gta.open.brokerage), "8.00");
check("GTA close brokerage (min applies)", money(gta.close.brokerage), "8.00");
check("GTA broker charges (two RM8 minimums)", money(gta.brokerCharges), "16.00");
check("GTA market charges", money(gta.marketCharges), "2.45");
check("GTA total fees", money(gta.total), "18.45");
check("GTA net P&L on +100 gross", money(100 - gta.total), "81.55");

// 3. Moomoo Malaysia: commission 0.03%, RM3 platform fee, SST only on selected asset classes
const moo = legFees(moomoo, 10900);
check("Moomoo commission", money(moo.brokerage), "3.27");
check("Moomoo platform fee", money(moo.platform), "3.00");
check("Moomoo clearing", money(moo.clearing), "3.27");
check("Moomoo stamp duty", money(moo.stampDuty), "11.00");
check("Moomoo shares pay no SST", money(moo.sst), "0.00");
check("Moomoo shares leg total", money(moo.total), "20.54");
const mooEtf = legFees(moomoo, 10900, { assetClass: "etf" });
check("Moomoo ETF SST on commission+platform+clearing", money(mooEtf.sst), "0.77");
check("Moomoo ETF leg total (stamp exempt)", money(mooEtf.total), "10.31");
const mooReit = legFees(moomoo, 10900, { assetClass: "reit_warrant" });
check("Moomoo REIT SST", money(mooReit.sst), "0.77");
check("Manual SST override on shares", money(legFees(mplus, 10900, { sstRate: 0.08 }).sst), "0.70");

// 4. M+ above the RM50k threshold uses 0.05%; intraday uses 0.05%
check("M+ RM60,000 brokerage", money(legFees(mplus, 60000).brokerage), "30.00");
check("M+ RM60,000 clearing", money(legFees(mplus, 60000).clearing), "18.00");
check("M+ RM60,000 stamp duty", money(legFees(mplus, 60000).stampDuty), "60.00");
check("M+ RM60,000 SST (shares are exempt)", money(legFees(mplus, 60000).sst), "0.00");
check("M+ RM60,000 SST when forced", money(legFees(mplus, 60000, { sstRate: 0.08 }).sst), "2.40");
check("M+ intraday RM10,900 (still RM8 min)", money(legFees(mplus, 10900, { intraday: true }).brokerage), "8.00");
check("M+ intraday RM60,000", money(legFees(mplus, 60000, { intraday: true }).brokerage), "30.00");

// 5. Stamp duty caps and exemptions
check("REIT/warrant stamp cap at RM200", money(legFees(mplus, 500000, { assetClass: "reit_warrant" }).stampDuty), "200.00");
check("Shares stamp cap at RM1,000", money(legFees(mplus, 5000000).stampDuty), "1000.00");
check("ETF stamp exempt", money(legFees(mplus, 10900, { assetClass: "etf" }).stampDuty), "0.00");
check("ETF still pays clearing", money(legFees(mplus, 10900, { assetClass: "etf" }).clearing), "3.27");
check("Clearing cap at RM1,000", money(legFees(mplus, 50000000).clearing), "1000.00");

// 6. FX/CFD trades stay charge-free so existing behaviour is unchanged
const fx = roundTripFees(moomoo, 1.1, 1.105, 100000, { assetClass: "fx" });
check("FX trade costs nothing", money(fx.total), "0.00");
check("Generic broker min RM8", money(legFees(generic, 900).brokerage), "8.00");
check("Fractional stamp duty rounds up", money(legFees(generic, 1001).stampDuty), "2.00");
check("Zero quantity is safe", money(roundTripFees(mplus, 1, 1, 0).total), "0.00");
check("Missing price is safe", money(roundTripFees(mplus, "", "", 100).total), "0.00");

// 7. iSaham's worked examples (RM0.80 shares). Clearing and stamp duty are Bursa-wide and match
// exactly; the article's flat 0.08% brokerage was the older M+ scheme, so the tiered online rate
// is used here (identical for orders up to RM50,000).
const ex1 = legFees(mplus, 10000 * 0.8);
check("iSaham ex1 brokerage (RM8 minimum beats 0.08%)", money(ex1.brokerage), "8.00");
check("iSaham ex1 clearing", money(ex1.clearing), "2.40");
check("iSaham ex1 stamp duty", money(ex1.stampDuty), "8.00");
check("iSaham ex1 total charges", money(ex1.total), "18.40");
const ex2 = legFees(mplus, 100000 * 0.8);
check("iSaham ex2 clearing", money(ex2.clearing), "24.00");
check("iSaham ex2 stamp duty", money(ex2.stampDuty), "80.00");
check("iSaham ex2 brokerage (0.05% tier above RM50k)", money(ex2.brokerage), "40.00");
check("iSaham ex2 total charges", money(ex2.total), "144.00");
const ex3 = legFees(mplus, 1000000 * 0.8);
check("iSaham ex3 clearing", money(ex3.clearing), "240.00");
check("iSaham ex3 stamp duty at 0.1% (below the RM1,000 cap)", money(ex3.stampDuty), "800.00");
check("iSaham ex3 brokerage (0.05% tier)", money(ex3.brokerage), "400.00");
check("0.08% still applies at the RM50,000 boundary", money(legFees(mplus, 50000).brokerage), "40.00");
check("0.05% kicks in just above RM50,000 (rounded up to the sen)", money(legFees(mplus, 50001).brokerage), "25.01");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll fee checks passed");
process.exit(failures ? 1 : 0);
