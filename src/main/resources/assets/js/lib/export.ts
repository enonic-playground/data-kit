export type ExportColumn<T extends Record<string, unknown> = Record<string, unknown>> = {
    key: keyof T & string;
    header: string;
};

export type ExportFormat = 'csv' | 'tsv';

function sanitizeFormulaPrefix(value: string): string {
    if (value.length > 0 && '=+-@'.includes(value[0])) return `'${value}`;
    return value;
}

function escapeCSVField(value: string): string {
    const safe = sanitizeFormulaPrefix(value);
    if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
        return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
}

function escapeTSVField(value: string): string {
    return sanitizeFormulaPrefix(value).replace(/[\t\n\r]/g, ' ');
}

function formatValue(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'number') return String(value);
    return String(value);
}

export function toCSV<T extends Record<string, unknown>>(rows: T[], columns: ExportColumn<T>[]): string {
    const header = columns.map(c => escapeCSVField(c.header)).join(',');
    const lines = rows.map(row =>
        columns.map(c => escapeCSVField(formatValue(row[c.key]))).join(','),
    );
    return `${[header, ...lines].join('\r\n')}\r\n`;
}

export function toTSV<T extends Record<string, unknown>>(rows: T[], columns: ExportColumn<T>[]): string {
    const header = columns.map(c => escapeTSVField(c.header)).join('\t');
    const lines = rows.map(row =>
        columns.map(c => escapeTSVField(formatValue(row[c.key]))).join('\t'),
    );
    return `${[header, ...lines].join('\r\n')}\r\n`;
}

export function downloadBlob(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
