"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SESSIONS, sessionLabel } from "@/lib/trading";
import { Select } from "@/components/select";
export type Filters={account:string;symbol:string;strategy:string;session:string;result:string;ipo:string;from:string;to:string;tag:string};
export const emptyFilters:Filters={account:"",symbol:"",strategy:"",session:"",result:"",ipo:"",from:"",to:"",tag:""};
export function FilterBar({filters,setFilters,accounts,strategies,tags}:{filters:Filters;setFilters:Dispatch<SetStateAction<Filters>>;accounts:any[];strategies:any[];tags:any[]}){
 // Starts closed: filters are something you reach for, not something that pushes the data down.
 const [open,setOpen]=useState(false);
 const active=Object.values(filters).filter(v=>v!=="").length;
 const upd=(k:keyof Filters,v:string)=>setFilters(prev=>({...prev,[k]:v}));
 return <div className="card card-pad filter-card">
  <div className="filter-head">
   <div><b>Filters</b><div className="muted filter-hint">{active?`${active} active`:"Refine the data without changing your journal."}</div></div>
   <div className="filter-actions">
    <button className="btn" type="button" onClick={()=>setOpen(x=>!x)} aria-expanded={open} aria-controls="filter-fields">
     {open?<ChevronUp size={15}/>:<ChevronDown size={15}/>}{open?"Hide":"Show"}
    </button>
    <button className="btn" type="button" disabled={!active} onClick={()=>setFilters({...emptyFilters})}>Reset</button>
   </div>
  </div>
  {open&&<div className="grid four filter-grid" id="filter-fields">
   <div className="field"><span>Account</span><Select aria-label="Account" value={filters.account} onChange={v=>upd("account",v)}><option value="">All accounts</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
   <div className="field"><span>Strategy</span><Select aria-label="Strategy" value={filters.strategy} onChange={v=>upd("strategy",v)}><option value="">All strategies</option>{strategies.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
   <label className="field">Symbol<input className="input" value={filters.symbol} placeholder="e.g. GTA" onChange={e=>upd("symbol",e.target.value)}/></label>
   <div className="field"><span>Session</span><Select aria-label="Session" value={filters.session} onChange={v=>upd("session",v)}><option value="">All sessions</option>{SESSIONS.map(x=><option key={x} value={x}>{sessionLabel(x)}</option>)}</Select></div>
   <div className="field"><span>Result</span><Select aria-label="Result" value={filters.result} onChange={v=>upd("result",v)}><option value="">All results</option><option value="win">Wins</option><option value="loss">Losses</option><option value="breakeven">Breakeven</option></Select></div>
   <div className="field"><span>Entry</span><Select aria-label="Entry" value={filters.ipo} onChange={v=>upd("ipo",v)}><option value="">All entries</option><option value="ipo">IPO allocation</option><option value="market">Market buy</option></Select></div>
   <div className="field"><span>Tag</span><Select aria-label="Tag" value={filters.tag} onChange={v=>upd("tag",v)}><option value="">All tags</option>{tags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</Select></div>
   <label className="field">From<input className="input" type="date" value={filters.from} onChange={e=>upd("from",e.target.value)}/></label>
   <label className="field">To<input className="input" type="date" value={filters.to} onChange={e=>upd("to",e.target.value)}/></label>
  </div>}
 </div>
}
export function applyFilters(ts:any[],f:Filters){return ts.filter(t=>{const pnl=Number(t.net_pnl||0);if(f.account&&t.account_id!==f.account)return false;if(f.strategy&&t.strategy_id!==f.strategy)return false;if(f.session&&t.session!==f.session)return false;if(f.result==="win"&&pnl<=0)return false;if(f.result==="loss"&&pnl>=0)return false;if(f.result==="breakeven"&&pnl!==0)return false;if(f.ipo==="ipo"&&!t.is_ipo)return false;if(f.ipo==="market"&&t.is_ipo)return false;if(f.symbol&&!String(t.symbol||"").toLowerCase().includes(f.symbol.trim().toLowerCase()))return false;if(f.from&&new Date(t.entry_at)<new Date(`${f.from}T00:00:00`))return false;if(f.to&&new Date(t.entry_at)>new Date(`${f.to}T23:59:59.999`))return false;if(f.tag&&!(t.trade_tags||[]).some((x:any)=>x.tag_id===f.tag))return false;return true})}
