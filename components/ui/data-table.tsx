"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Rows per page offered in the footer. */
const PAGE_SIZES = [10, 15, 25, 50] as const;

/**
 * The id of the synthetic column that carries the free-text search. TanStack filters by column, so
 * searching several fields at once needs a column that already concatenates them.
 */
const SEARCH_COLUMN = "__search";

/**
 * A table on TanStack Table: sorting on every header, free-text search, paging, and a menu to hide
 * columns. Cells are plain React nodes, so a table can keep rendering badges and links.
 */
export function DataTable<TData>({
  columns,
  data,
  searchText,
  searchPlaceholder = "Search…",
  initialSorting = [],
  initialVisibility = {},
  pageSize = 15,
  compact = false,
  onRowClick,
  onRowHover,
  empty = "No rows match these filters.",
  toolbar,
  className,
}: {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  /** Concatenated text a row can be searched by. Omit to hide the search box. */
  searchText?: (row: TData) => string;
  searchPlaceholder?: string;
  initialSorting?: SortingState;
  initialVisibility?: VisibilityState;
  pageSize?: number;
  compact?: boolean;
  onRowClick?: (row: TData) => void;
  /** Fired once when the pointer first enters a row — a cue to prefetch wherever the row leads,
   *  not a hover-tracking callback (it does not fire again until the pointer leaves and returns). */
  onRowHover?: (row: TData) => void;
  empty?: string;
  toolbar?: React.ReactNode;
  className?: string;
}) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [visibility, setVisibility] = React.useState<VisibilityState>(initialVisibility);
  const [filter, setFilter] = React.useState("");

  const allColumns = React.useMemo<ColumnDef<TData, any>[]>(() => {
    if (!searchText) return columns;
    return [
      {
        id: SEARCH_COLUMN,
        accessorFn: row => searchText(row),
        enableHiding: false,
        enableSorting: false,
      },
      ...columns,
    ];
  }, [columns, searchText]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, columnVisibility: visibility, globalFilter: filter },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    // `searchText` already builds one string with everything a caller wants matched (symbol,
    // strategy, sector, session…) into the hidden `__search` column above, so a table that has
    // one only needs to check that column — not re-derive the same text by re-stringifying every
    // visible cell of every row on every keystroke. The all-cells scan is kept only as a fallback
    // for the rare table with no `searchText` at all.
    globalFilterFn: (row, _columnId, value) => {
      const needle = String(value ?? "").trim().toLowerCase();
      if (!needle) return true;
      if (searchText) return String(row.getValue(SEARCH_COLUMN) ?? "").toLowerCase().includes(needle);
      return row
        .getAllCells()
        .some(cell => String(cell.getValue() ?? "").toLowerCase().includes(needle));
    },
  });

  // The search column is a filter input, not a column of the table.
  const columns_ = table.getAllLeafColumns().filter(c => c.id !== SEARCH_COLUMN);
  const showSearch = Boolean(searchText);
  const hideable = columns_.filter(c => c.getCanHide());

  return (
    <div className={cn("grid", className)}>
      {(showSearch || toolbar || hideable.length) && (
        <div className="dt-toolbar">
          {showSearch && (
            <div className="dt-toolbar-main">
              <div className="dt-search-wrap relative">
                <Search
                  size={15}
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--muted)]"
                />
                <Input
                  className="dt-search pl-9"
                  placeholder={searchPlaceholder}
                  value={filter}
                  onChange={e => {
                    setFilter(e.target.value);
                    table.setPageIndex(0);
                  }}
                  aria-label={searchPlaceholder}
                />
                {filter && (
                  <button
                    type="button"
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)]"
                    aria-label="Clear search"
                    onClick={() => setFilter("")}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <span className="muted dt-count">
                {table.getFilteredRowModel().rows.length} of {data.length}
              </span>
            </div>
          )}
          <div className="dt-toolbar-actions">
            {toolbar}
            {hideable.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="secondary" size="sm" title="Choose columns">
                    <Columns3 size={14} />
                    Columns
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="dt-colmenu">
                  {/* Only the columns that can actually be hidden. Listing the rest meant a row that
                      toggled nothing and carried no label — an empty checkbox with no caption. */}
                  {hideable.map(column => (
                    <label className="dt-collabel" key={column.id}>
                      <Checkbox
                        checked={column.getIsVisible()}
                        onCheckedChange={value => column.toggleVisibility(!!value)}
                      />
                      {columnLabel(column.columnDef.header, column.id)}
                    </label>
                  ))}
                  {hideable.some(column => !column.getIsVisible()) && (
                    <button
                      type="button"
                      className="dt-colreset"
                      onClick={() => table.resetColumnVisibility()}
                    >
                      Show every column
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      )}

      {/* `.table-compact` classes the cells from the wrapper, which is what the breakdown tables use. */}
      <Table wrapClassName={compact ? "table-compact" : undefined}>
        <TableHeader>
          {table.getHeaderGroups().map(group => (
            <TableRow key={group.id}>
              {group.headers
                .filter(header => header.column.id !== SEARCH_COLUMN)
                .map(header => (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : undefined
                    }
                  >
                    {header.column.getCanSort() && !header.isPlaceholder ? (
                      <button
                        type="button"
                        className="dt-sort"
                        data-sorted={header.column.getIsSorted() ? "true" : "false"}
                        onClick={header.column.getToggleSortingHandler()}
                        title={`Sort by ${columnLabel(header.column.columnDef.header, header.column.id)}`}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === "asc" ? (
                          <ArrowUp size={12} aria-hidden />
                        ) : header.column.getIsSorted() === "desc" ? (
                          <ArrowDown size={12} aria-hidden />
                        ) : (
                          <ChevronsUpDown size={12} aria-hidden />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map(row => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onMouseEnter={onRowHover ? () => onRowHover(row.original) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row.original);
                        }
                      }
                    : undefined
                }
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {row
                  .getVisibleCells()
                  .filter(cell => cell.column.id !== SEARCH_COLUMN)
                  .map(cell => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={Math.max(1, columns_.length)}>
                <div className="empty">{empty}</div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {table.getFilteredRowModel().rows.length > 0 && (
        <div className="dt-foot">
          <div className="dt-pager">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="muted dt-page-of">
              Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </Button>
          </div>
          <div className="dt-pager">
            <span className="muted">Rows</span>
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={value => {
                table.setPageSize(Number(value));
                table.setPageIndex(0);
              }}
            >
              <SelectTrigger size="sm" style={{ width: 84 }} aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map(size => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

/** A header is often a node; the column menu and the sort tooltip want plain text. */
function columnLabel(header: unknown, fallback: string) {
  if (typeof header === "string") return header;
  if (typeof header === "number") return String(header);
  return fallback.replace(/^_+/, "");
}
