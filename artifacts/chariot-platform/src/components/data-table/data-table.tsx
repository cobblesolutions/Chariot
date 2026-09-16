import * as React from "react";
import {
  useTable,
  type ColumnDef,
  type Row,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "./data-table-pagination";
import { features, type DataTableFeatures } from "./features";

type DataTableProps<TData extends RowData> = {
  columns: ColumnDef<DataTableFeatures, TData, any>[];
  data: TData[];
  /** Rendered inside the table when there are no rows. */
  emptyMessage?: React.ReactNode;
  /** Makes rows clickable (adds pointer + click handler). */
  onRowClick?: (row: TData) => void;
  /** Initial sort, e.g. [{ id: "dueDate", desc: false }]. */
  initialSorting?: SortingState;
  /** Marks a row as selected (stock `data-state="selected"` styling). */
  isRowSelected?: (row: TData) => boolean;
  /** Optional extra props per row (e.g. refs for scroll-to-row). */
  rowProps?: (
    row: Row<DataTableFeatures, TData>,
  ) => React.ComponentProps<typeof TableRow>;
  className?: string;
  pageSize?: number;
};

/** shadcn data-table guide: TanStack Table v9 + <Table />, wrapped in a Card. */
function DataTable<TData extends RowData>({
  columns,
  data,
  emptyMessage = "No results.",
  onRowClick,
  initialSorting = [],
  isRowSelected,
  rowProps,
  className,
  pageSize = 25,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize,
  });

  const table = useTable({
    features,
    data,
    columns,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    state: { sorting, pagination },
  });

  const rows = table.getRowModel().rows;

  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <Table>
        <TableHeader className="bg-muted/50">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={header.column.columnDef.meta?.headerClassName}
                >
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => {
              const extra = rowProps?.(row) ?? {};
              return (
                <TableRow
                  key={row.id}
                  data-state={
                    isRowSelected?.(row.original) ? "selected" : undefined
                  }
                  {...extra}
                  className={cn(
                    onRowClick && "cursor-pointer",
                    extra.className,
                  )}
                  onClick={
                    onRowClick ? () => onRowClick(row.original) : extra.onClick
                  }
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cell.column.columnDef.meta?.cellClassName}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {table.getRowCount() > pageSize || table.getPageCount() > 1 ? (
        <div className="border-t">
          <DataTablePagination table={table} />
        </div>
      ) : null}
    </Card>
  );
}

export { DataTable };
