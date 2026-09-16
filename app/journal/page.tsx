"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, SquarePen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FilterBar, emptyFilters, applyFilters, type Filters } from "@/components/filter-bar";
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
import { formatMoney, formatR, normalizeTrade, shortDateTime, type Trade } from "@/lib/trading";

export default function Journal() {
  const [r, setR] = useState<Trade[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [f, setF] = useState<Filters>(emptyFilters);
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => { (async () => {
    const s = createClient();
    const COLUMNS = "symbol,direction,entry_at,exit_at,net_pnl,r_multiple,session,account_id,strategy_id,strategies(name),trading_accounts(name),trade_tags(tag_id)";
    const [a0, b, c, d] = await Promise.all([
      s.from("trades").select(`id,is_ipo,${COLUMNS}`).order("entry_at", { ascending: false }),
      s.from("trading_accounts").select("id,name,currency"),
      s.from("strategies").select("id,name"),
      s.from("tags").select("id,name"),
    ]);
    // `is_ipo` arrives with the Phase 9 migration; until then the journal still lists trades.
    const a = a0.error ? await s.from("trades").select(`id,${COLUMNS}`).order("entry_at", { ascending: false }) : a0;
    setLoadError(firstError(a, b, c, d));
    setR((a.data ?? []).map(normalizeTrade) as Trade[]);
    setAccounts(b.data ?? []);
    setStrategies(c.data ?? []);
    setTags(d.data ?? []);
  })(); }, []);

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
      actions={<Button onClick={() => router.push("/journal/new")}>+ Add Trade</Button>}
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
          searchText={row => `${row.symbol} ${row.strategies?.name ?? ""} ${row.session ?? ""}`}
          searchPlaceholder="Search symbol, strategy or session…"
          pageSize={15}
          onRowClick={row => router.push(`/journal/${row.id}`)}
          empty="No trades match these filters."
        />
      </div>
    </div>}
  </div>;
}
