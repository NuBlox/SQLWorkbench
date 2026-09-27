import type { QueryCellValue, QueryResultSetView } from "../lib/desktop-api.js";

export function serializeResultSetCsv(resultSet: QueryResultSetView): string {
  const headers = columnNames(resultSet);
  if (headers.length === 0) return "";

  const lines = [headers.map((header) => csvField(spreadsheetSafe(header))).join(",")];
  for (const row of resultSet.rows) {
    lines.push(headers.map((header) => csvField(spreadsheetSafe(row[header] ?? null))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function serializeResultSetJson(resultSet: QueryResultSetView): string {
  return `${JSON.stringify({
    columns: resultSet.columns,
    rows: resultSet.rows,
    summary: {
      ...(resultSet.affectedRows !== undefined ? { affectedRows: resultSet.affectedRows } : {}),
      ...(resultSet.changedRows !== undefined ? { changedRows: resultSet.changedRows } : {}),
      ...(resultSet.insertId !== undefined ? { insertId: resultSet.insertId } : {}),
      ...(resultSet.warningCount !== undefined ? { warningCount: resultSet.warningCount } : {}),
      ...(resultSet.message !== undefined ? { message: resultSet.message } : {}),
    },
  }, null, 2)}\n`;
}

function columnNames(resultSet: QueryResultSetView): string[] {
  if (resultSet.columns.length > 0) return resultSet.columns.map((column) => column.name);
  const names = new Set<string>();
  for (const row of resultSet.rows) {
    for (const key of Object.keys(row)) names.add(key);
  }
  return [...names];
}

function csvField(value: QueryCellValue): string {
  const text = value === null ? "" : String(value);
  if (!/[",\r\n]/u.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function spreadsheetSafe(value: QueryCellValue): QueryCellValue {
  if (typeof value !== "string") return value;
  if (/^[=+\-@]/u.test(value)) return `'${value}`;
  return value;
}
