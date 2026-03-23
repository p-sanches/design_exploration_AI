import { setFrame } from './broadcast.js';

let rows = [];
let index = 0;
let loopId = null;
let columnNames = [];

function rowToFrame(row) {
  return {
    type: 'bioframe',
    source: 'csv',
    timestamp: Date.now(),
    rowIndex: index,
    columns: columnNames,
    row,  // The entire CSV row as-is: { ColumnName: value, ... }
  };
}

export function startCSV(parsedRows, columns, onColumns) {
  rows = parsedRows;
  columnNames = columns;
  index = 0;
  if (onColumns) onColumns(columns);

  if (loopId) clearInterval(loopId);
  loopId = setInterval(() => {
    if (rows.length === 0) return;
    const row = rows[index % rows.length];
    setFrame(rowToFrame(row));
    index++;
  }, 100);
}

export function stopCSV() {
  if (loopId) { clearInterval(loopId); loopId = null; }
  rows = [];
  index = 0;
  columnNames = [];
}
