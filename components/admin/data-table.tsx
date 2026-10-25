"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Serialisable table contract: server components pre-render each cell and pass
// plain strings/numbers for search and sort. No functions cross the boundary.
export type ColumnDef = {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  hideBelow?: "sm" | "md" | "lg";
};

export type RowDef = {
  id: string;
  cells: React.ReactNode[];
  sort: (string | number)[];
  search: string;
  csv?: Record<string, string | number>;
  href?: string;
};

function downloadCsv(name: string, rows: Record<string, string | number>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type Sort = { index: number; dir: "asc" | "desc" };

export function DataTable({
  rows,
  columns,
  searchPlaceholder = "Search…",
  csvName,
  emptyTitle = "Nothing here",
  emptyDescription = "No rows match the current view.",
  defaultPageSize = 10,
  pageSizes = [10, 25, 50, 100],
  toolbar,
}: {
  rows: RowDef[];
  columns: ColumnDef[];
  searchPlaceholder?: string;
  csvName?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  defaultPageSize?: number;
  pageSizes?: number[];
  toolbar?: React.ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const visible = useMemo(() => {
    let out = rows;
    if (query) {
      const q = query.toLowerCase();
      out = out.filter((r) => r.search.includes(q));
    }
    if (sort) {
      out = [...out].sort((a, b) => {
        const av = a.sort[sort.index] ?? "";
        const bv = b.sort[sort.index] ?? "";
        if (typeof av === "number" && typeof bv === "number") return sort.dir === "asc" ? av - bv : bv - av;
        return sort.dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    return out;
  }, [rows, query, sort]);

  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const pageRows = visible.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const toggleSort = (index: number, col: ColumnDef) => {
    if (!col.sortable) return;
    setSort((s) =>
      s?.index === index ? (s.dir === "asc" ? { index, dir: "desc" } : null) : { index, dir: "asc" }
    );
    setPage(0);
  };

  const hideClass: Record<string, string> = {
    sm: "hidden sm:table-cell",
    md: "hidden md:table-cell",
    lg: "hidden lg:table-cell",
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <InputGroup className="w-full sm:max-w-xs">
          <InputGroupAddon>
            <Search className="size-4" aria-hidden="true" />
          </InputGroupAddon>
          <Input
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
          />
        </InputGroup>
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {visible.length} row{visible.length === 1 ? "" : "s"}
          </span>
          {csvName && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv(csvName, visible.map((r) => r.csv ?? {}))}
              disabled={!visible.length}
            >
              <Download data-icon="inline-start" aria-hidden="true" />
              CSV
            </Button>
          )}
        </div>
      </div>

      {pageRows.length === 0 ? (
        <div className="py-10">
          <Empty>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyContent>
              <EmptyDescription>{emptyDescription}</EmptyDescription>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col, i) => (
                <TableHead key={col.key} className={cn(col.className, col.hideBelow && hideClass[col.hideBelow])}>
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(i, col)}
                      className="inline-flex cursor-pointer items-center gap-1 hover:text-slate-900"
                    >
                      {col.header}
                      {sort?.index === i ? (
                        sort.dir === "asc" ? (
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(row.href && "cursor-pointer")}
                onClick={row.href ? () => router.push(row.href!) : undefined}
              >
                {row.cells.map((cell, i) => (
                  <TableCell key={columns[i]?.key ?? i} className={cn(columns[i]?.className, columns[i]?.hideBelow && hideClass[columns[i]!.hideBelow])}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Rows per page</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}>
              <SelectTrigger size="sm" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizes.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              aria-label="Previous page"
            >
              <ChevronLeft data-icon="inline-start" aria-hidden="true" />
              Prev
            </Button>
            <span className="text-xs text-slate-500">
              {safePage + 1} / {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={safePage >= pages - 1}
              aria-label="Next page"
            >
              Next
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
