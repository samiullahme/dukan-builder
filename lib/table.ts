import type { ColumnDef, RowDef } from "@/components/admin/data-table";

// Server-side descriptor for a table column. Functions stay here (server
// components only); toTable() turns them into serialisable RowDefs so nothing
// but plain data crosses into the client DataTable.
export type AdminColumn<T> = {
  key: string;
  header: string;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null;
  render: (row: T) => React.ReactNode;
  className?: string;
  hideBelow?: "sm" | "md" | "lg";
};

export function toTable<T>(
  columns: AdminColumn<T>[],
  rows: T[],
  opts: {
    key: (r: T) => string;
    search?: (r: T) => string;
    csv?: (r: T) => Record<string, string | number>;
  }
): { columns: ColumnDef[]; rows: RowDef[] } {
  const cols: ColumnDef[] = columns.map(({ key, header, sortable, className, hideBelow }) => ({
    key,
    header,
    sortable,
    className,
    hideBelow,
  }));
  const out: RowDef[] = rows.map((r) => {
    const sortValues = columns.map((c) => c.sortValue?.(r) ?? "");
    return {
      id: opts.key(r),
      cells: columns.map((c) => c.render(r)),
      sort: sortValues,
      search: (opts.search?.(r) ?? sortValues.map((v) => String(v)).join(" ")).toLowerCase(),
      csv: opts.csv?.(r),
    };
  });
  return { columns: cols, rows: out };
}
