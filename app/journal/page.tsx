"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, SquarePen } from "lucide-react";
import { KEYS, loadAccounts, loadStrategies, loadTags, loadTrades } from "@/lib/data";
import { invalidate, useCachedQuery } from "@/lib/query-cache";
import { FilterBar, emptyFilters, applyFilters, type Filters } from "@/components/filter-bar";
import { SectorManager } from "@/components/sector-manager";
import { PageHeader } from "@/components/page-header";
import { LoadError } from "@/components/load-error";
import { TableSkeleton } from "@/components/skeletons";
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
import { formatMoney, formatR, shortDateTime, type Trade } from "@/lib/trading";

export default function Journal() {
  // The same rows the dashboard and the analytics already hold, so opening the journal costs no
  // query at all once the app has been walked through once.
  const tradesQ = useCachedQuery<Trade[]>(KEYS.trades, loadTrades);
  const accountsQ = useCachedQuery<any[]>(KEYS.accounts, loadAccounts);
  const strategiesQ = useCachedQuery<any[]>(KEYS.strategies, loadStrategies);
  const tagsQ = useCachedQuery<any[]>(KEYS.tags, loadTags);
  const [f, setF] = useState<Filters>(emptyFilters);
  const router = useRouter();

  const r = tradesQ.data ?? [];
  const accounts = accountsQ.data ?? [];
  const strategies = strategiesQ.data ?? [];
  const tags = tagsQ.data ?? [];
  const loadError = tradesQ.error ?? accountsQ.error ?? strategiesQ.error ?? tagsQ.error;
  const loading = tradesQ.loading;

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
        <SectorManager trades={r} onSaved={() => invalidate(KEYS.trades)} />
        <Button onClick={() => router.push("/journal/new")}>+ Add Trade</Button>
      </>}
    />
    <LoadError message={loadError} what="your trades" />
    <FilterBar filters={f} setFilters={setF} accounts={accounts} strategies={strategies} tags={tags} />
    {/* A failed load leaves the table saying "No trades match these filters", which reads as an
        empty journal rather than an unreadable one — the banner above says it instead. */}
    {loadError?null:loading?<TableSkeleton/>:<div className="card">
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
