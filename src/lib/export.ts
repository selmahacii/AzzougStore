export function exportToCSV(data: Record<string, unknown>[], filename: string, columns: { key: string; label: string }[]): void {
  const headers = columns.map(c => c.label).join(',');
  const rows = data.map(row =>
    columns.map(col => {
      const val = String(row[col.key] ?? '');
      // Escape CSV: wrap in quotes if contains comma, quote, or newline
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',')
  );
  const csv = [headers, ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatCSVDate(date: string | Date | null): string {
  if (!date) return '';
  return new Date(date).toLocaleDateString('fr-FR');
}

export function formatCSVPrice(price: number | null): string {
  if (price == null) return '0';
  return String(price);
}
