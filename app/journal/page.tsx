"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, SquarePen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FilterBar, emptyFilters, applyFilters, type Filters } from "@/components/filter-bar";
import { SectorManager } from "@/components/sector-manager";
import { PageHeader } from "@/components/page-header";
import { LoadError, firstError } from "@/components/load-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { embedAccount, embedStrategy, formatMoney, formatR, normalizeTrade, shortDateTime, type Trade } from "@/lib/trading";

export default function Journal() {
  const [r, setR] = useState<Trade[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [f, setF] = useState<Filters>(emptyFilters);
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    const s = createClient();
    const COLUMNS = `symbol,direction,entry_at,exit_at,net_pnl,r_multiple,session,account_id,strategy_id,${embedStrategy()},${embedAccount()},trade_tags(tag_id)`;
    // `sector` arrives with supabase/sectors.sql and `is_ipo` with the Phase 9 block, and the journal
    // must list trades on a database that has neither — so the select steps down through the columns
    // that may not exist yet rather than showing an error in place of the journal.
    const SELECTS = [
      `id,is_ipo,sector,${COLUMNS}`,
      `id,is_ipo,${COLUMNS}`,
      `id,${COLUMNS}`,
    ];
    const [b, c, d] = await Promise.all([
      s.from("trading_accounts").select("id,name,currency"),
      s.from("strategies").select("id,name"),
      s.from("tags").select("id,name"),
    ]);
    let a = await s.from("trades").select(SELECTS[0]).order("entry_at", { ascending: false });
    for (let i = 1; i < SELECTS.length && a.error; i++) {
      a = await s.from("trades").select(SELECTS[i]).order("entry_at", { ascending: false });
    }
    setLoadError(firstError(a, b, c, d));
    setR((a.data ?? []).map(normalizeTrade) as Trade[]);
    setAccounts(b.data ?? []);
    setStrategies(c.data ?? []);
    setTags(d.data ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  // The calendar's "View in Journal" links here with a date range, so land pre-filtered on that day.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    if (from || to) setF(prev => ({ ...prev, from, to }));
  }, []);

  const rows = useMemo(() => applyFilters(r, f), [r, f]);
  const currency = accounts.find(a => a.id === f.account)?.currency;

  const columns = useMemo<ColumnDef<Trade, any>[]>(() => [
    {
      id: "entry_at",
      accessorFn: row => row.entry_at,
      header: "Date",
      cell: ({ row }) => shortDateTime(row.original.entry_at),
    },
    {
      id: "symbol",
      accessorFn: row => row.symbol,
      header: "Symbol",
      cell: ({ row }) => (
        <>
          <b>{row.original.symbol}</b>
          {row.original.is_ipo && <Badge variant="ipo" className="ml-2">IPO</Badge>}
        </>
      ),
    },
    {
      id: "sector",
      accessorFn: row => row.sector ?? "",
      header: "Sector",
      // Bands of neighbouring trades share a sector, so the name is only drawn when it changes —
      // a column of repeated names is noise beside a column that reads as one block.
      cell: ({ row, table }) => {
        const sector = row.original.sector;
        if (!sector) return <span className="muted">—</span>;
        const sorted = table.getSortedRowModel().rows;
        const at = sorted.findIndex(r => r.id === row.id);
        const previous = at > 0 ? sorted[at - 1].original.sector : null;
        return <span className={previous === sector ? "sector-repeat" : "sector-chip"}>{sector}</span>;
      },
    },
    {
      id: "strategy",
      accessorFn: row => row.strategies?.name ?? "",
      header: "Strategy",
      cell: ({ row }) => row.original.strategies?.name || "—",
    },
    {
      id: "session",
      accessorFn: row => row.session ?? "",
      header: "Session",
      cell: ({ row }) => row.original.session || "—",
    },
    {
      accessorKey: "net_pnl",
      header: "P&L",
      cell: ({ row }) => (
        <span className={Number(row.original.net_pnl) >= 0 ? "positive" : "negative"}>
          {formatMoney(row.original.net_pnl, currency, true)}
        </span>
      ),
    },
    {
      accessorKey: "r_multiple",
      header: "R",
      cell: ({ row }) => (row.original.r_multiple == null ? "—" : formatR(row.original.r_multiple)),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        // The menu must not also trigger the row's own click, which opens the trade.
        <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${row.original.symbol}`}>
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{row.original.symbol}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push(`/journal/${row.original.id}`)}>
                Open trade
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push(`/journal/${row.original.id}/edit`)}>
                <SquarePen size={15} />
                Edit trade
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ], [currency, router]);

  return <div className="content">
    <PageHeader
      title="Trade Journal"
      subtitle={`${rows.length} matching trade${rows.length === 1 ? "" : "s"}`}
      actions={<>
        <SectorManager trades={r} onSaved={load} />
        <Button onClick={() => router.push("/journal/new")}>+ Add Trade</Button>
      </>}
    />
    <LoadError message={loadError} what="your trades" />
    <FilterBar filters={f} setFilters={setF} accounts={accounts} strategies={strategies} tags={tags} />
    {/* A failed load leaves the table saying "No trades match these filters", which reads as an
        empty journal rather than an unreadable one — the banner above says it instead. */}
    {loadError?null:<div className="card">
      <div className="card-content">
        <DataTable
          columns={columns}
          data={rows}
          initialSorting={[{ id: "entry_at", desc: true }]}
          searchText={row => `${row.symbol} ${row.sector ?? ""} ${row.strategies?.name ?? ""} ${row.session ?? ""}`}
          searchPlaceholder="Search symbol, sector, strategy or session…"
          pageSize={15}
          onRowClick={row => router.push(`/journal/${row.id}`)}
          empty="No trades match these filters."
        />
      </div>
    </div>}
  </div>;
}
