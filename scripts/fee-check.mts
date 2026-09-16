import { brokerPreset, financedShare, IPO_CHANNELS, ipoChannel, ipoCharge, legFees, roundTripFees } from "../lib/fees.ts";

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

// 8. IPO subscriptions. An application is not a market buy: the opening leg is priced by the
//    channel, so no brokerage, clearing fee or stamp duty is charged on it.
const cashMplus = roundTripFees(mplus, 0.5, 0.6, 2000, { assetClass: "shares", ipo: { channel: "mplus", method: "cash", multiple: null, financed: 0, days: 0 } });
check("M+ cash IPO pays nothing to apply", money(cashMplus.open.total), "0.00");
check("M+ cash IPO has no brokerage on the opening leg", money(cashMplus.open.brokerage), "0.00");
check("M+ cash IPO has no stamp duty on the opening leg", money(cashMplus.open.stampDuty), "0.00");
check("M+ cash IPO still carries the contract value", money(cashMplus.open.contractValue), "1000.00");
const marketBuy = roundTripFees(mplus, 0.5, 0.6, 2000, { assetClass: "shares" });
// The same RM1,000 contract as a market buy: RM8 minimum brokerage, 0.30 clearing, RM1 stamp.
check("the same trade as a market buy pays an opening leg", money(marketBuy.open.total), "9.30");
check("market buy total is the two legs", money(marketBuy.total), "19.66");
check("M+ cash IPO total is the sell leg alone", money(cashMplus.total), "10.36");
check("M+ cash IPO charges are broker vs market split", `${money(cashMplus.brokerCharges)}/${money(cashMplus.marketCharges)}`, "8.00/2.36");

// Maybank eShare: RM1 per application plus 8% SST on it.
const maybank = ipoCharge({ channel: "maybank", method: "cash", multiple: null, financed: 0, days: 0 });
check("Maybank application fee", money(maybank.applicationFee), "1.00");
check("Maybank SST on the application fee", money(maybank.applicationSst), "0.08");
check("Maybank subscription total", money(maybank.total), "1.08");
check("Maybank offers no financing in-app", String(ipoChannel("maybank").financing), "null");
const maybankRound = roundTripFees(mplus, 0.5, 0.6, 2000, { assetClass: "shares", ipo: { channel: "maybank", method: "financing", multiple: 10, financed: 5000, days: 30 } });
check("a cash-only channel cannot be financed", money(maybankRound.ipo!.financingFee), "0.00");
check("a cash-only channel still charges its RM1.08", money(maybankRound.ipo!.total), "1.08");

// Moomoo: free application, 6.8% p.a. on what is borrowed.
const moomooIpo = ipoCharge({ channel: "moomoo", method: "financing", multiple: null, financed: 10000, days: 10 });
check("Moomoo application is free", money(moomooIpo.applicationFee), "0.00");
check("Moomoo financing at 6.8% p.a. for 10 days", money(moomooIpo.financingFee), "18.64");
check("Moomoo subscription total", money(moomooIpo.total), "18.64");

// M+ financing: financed x 8% p.a. / 365 x days, plus 8% SST, and only when something is borrowed.
const tiers = IPO_CHANNELS.find(c => c.id === "mplus")!.financing!.leverages;
check("2x finances half", String(financedShare(2)), "0.5");
check("5x finances four fifths", String(financedShare(5)), "0.8");
check("10x finances nine tenths", String(financedShare(10)), "0.9");
check("the 2x tier asks for the published RM10,000", String(tiers[0].minDeposit), "10000");
check("the 10x tier asks for the published RM500,000", String(tiers[2].minApplication), "500000");
const mplus2x = ipoCharge({ channel: "mplus", method: "financing", multiple: 2, financed: 5000, days: 7 });
check("M+ financing 5,000 at 8% p.a. for 7 days", money(mplus2x.financingFee), "7.68");
check("M+ SST on the financing charge", money(mplus2x.financingSst), "0.62");
check("M+ financing total", money(mplus2x.total), "8.30");
check("M+ 2x rate is reported", String(mplus2x.rate), "0.08");
check("M+ cash reports no rate", String(ipoCharge({ channel: "mplus", method: "financing", multiple: 2, financed: 0, days: 7 }).rate), "null");
check("financing with no amount is priced as cash", money(ipoCharge({ channel: "mplus", method: "financing", multiple: 5, financed: 0, days: 7 }).total), "0.00");
check("financing with no days is priced as cash", money(ipoCharge({ channel: "mplus", method: "financing", multiple: 5, financed: 5000, days: 0 }).total), "0.00");
const mplus10x = roundTripFees(mplus, 1, 1.1, 50000, { assetClass: "shares", ipo: { channel: "mplus", method: "financing", multiple: 10, financed: 45000, days: 7 } });
check("10x financing on RM45,000 for 7 days", money(mplus10x.ipo!.financingFee), "69.05");
// RM55,000 of stock sold: 0.05% brokerage, 0.03% clearing, RM55 stamp — and nothing on the buy side.
check("an IPO round trip keeps the sell leg's market charges", money(mplus10x.marketCharges), "71.50");
check("the 10x subscription total", money(mplus10x.ipo!.total), "74.58");
check("an IPO round trip adds the subscription to the broker charges", money(mplus10x.brokerCharges), "102.08");
check("the IPO round trip total", money(mplus10x.total), "173.58");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll fee checks passed");
process.exit(failures ? 1 : 0);
