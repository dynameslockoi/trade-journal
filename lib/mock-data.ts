export type Trade = {
  id:string; date:string; symbol:string; direction:"Long"|"Short"; strategy:string;
  session:string; pnl:number; r:number; result:"Win"|"Loss"|"BE"; emotion:string; account:string;
};

export const trades: Trade[] = [
 {id:"1",date:"2026-09-14",symbol:"XAUUSD",direction:"Long",strategy:"Liquidity Sweep",session:"London",pnl:420,r:2.1,result:"Win",emotion:"Confident",account:"FTMO"},
 {id:"2",date:"2026-09-14",symbol:"EURUSD",direction:"Short",strategy:"Breakout",session:"London",pnl:-120,r:-1,result:"Loss",emotion:"FOMO",account:"FTMO"},
 {id:"3",date:"2026-09-13",symbol:"NAS100",direction:"Long",strategy:"Reversal",session:"New York",pnl:310,r:1.8,result:"Win",emotion:"Calm",account:"FTMO"},
 {id:"4",date:"2026-09-12",symbol:"BTCUSD",direction:"Long",strategy:"Trend Continuation",session:"New York",pnl:560,r:2.4,result:"Win",emotion:"Confident",account:"Personal"},
 {id:"5",date:"2026-09-11",symbol:"XAUUSD",direction:"Short",strategy:"Liquidity Sweep",session:"London",pnl:-240,r:-1,result:"Loss",emotion:"Revenge",account:"FTMO"},
 {id:"6",date:"2026-09-10",symbol:"EURUSD",direction:"Long",strategy:"Breakout",session:"London",pnl:180,r:1.2,result:"Win",emotion:"Calm",account:"FTMO"},
 {id:"7",date:"2026-09-09",symbol:"XAUUSD",direction:"Long",strategy:"Liquidity Sweep",session:"London",pnl:340,r:1.7,result:"Win",emotion:"Confident",account:"FTMO"},
 {id:"8",date:"2026-09-08",symbol:"NAS100",direction:"Short",strategy:"Reversal",session:"New York",pnl:-150,r:-1,result:"Loss",emotion:"Uncertain",account:"FTMO"}
];

export const equity = [
 {d:"Sep 1",v:100000},{d:"Sep 2",v:100240},{d:"Sep 3",v:100160},{d:"Sep 4",v:100590},
 {d:"Sep 5",v:100800},{d:"Sep 8",v:101100},{d:"Sep 9",v:101440},{d:"Sep 10",v:101620},
 {d:"Sep 11",v:101380},{d:"Sep 12",v:101940},{d:"Sep 13",v:102250},{d:"Sep 14",v:102670}
];
