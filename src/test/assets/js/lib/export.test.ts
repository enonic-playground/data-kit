import { describe, expect, it } from 'vitest';
import { type ExportColumn, toCSV, toTSV } from '../../../../main/resources/assets/js/lib/export';

type TestRow = {
    id: string;
    name: string;
    score: number;
};

const columns: ExportColumn<TestRow>[] = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'Name' },
    { key: 'score', header: 'Score' },
];

describe('toCSV', () => {
    it('should produce header and rows with correct column ordering', () => {
        const rows: TestRow[] = [
            { id: '1', name: 'Alice', score: 9.5 },
            { id: '2', name: 'Bob', score: 7 },
        ];
        const result = toCSV(rows, columns);
        expect(result).toBe('ID,Name,Score\r\n1,Alice,9.5\r\n2,Bob,7\r\n');
    });

    it('should escape fields containing commas', () => {
        const rows: TestRow[] = [{ id: '1', name: 'Doe, Jane', score: 1 }];
        const result = toCSV(rows, columns);
        expect(result).toBe('ID,Name,Score\r\n1,"Doe, Jane",1\r\n');
    });

    it('should escape fields containing double quotes', () => {
        const rows: TestRow[] = [{ id: '1', name: 'Say "hello"', score: 1 }];
        const result = toCSV(rows, columns);
        expect(result).toBe('ID,Name,Score\r\n1,"Say ""hello""",1\r\n');
    });

    it('should escape fields containing newlines', () => {
        const rows: TestRow[] = [{ id: '1', name: 'line1\nline2', score: 1 }];
        const result = toCSV(rows, columns);
        expect(result).toBe('ID,Name,Score\r\n1,"line1\nline2",1\r\n');
    });

    it('should convert undefined and null values to empty strings', () => {
        type Partial = { a: string | undefined; b: string | null };
        const cols: ExportColumn<Partial>[] = [
            { key: 'a', header: 'A' },
            { key: 'b', header: 'B' },
        ];
        const rows = [{ a: undefined, b: null }] as unknown as Partial[];
        const result = toCSV(rows, cols);
        expect(result).toBe('A,B\r\n,\r\n');
    });

    it('should return header-only for empty rows', () => {
        const result = toCSV([], columns);
        expect(result).toBe('ID,Name,Score\r\n');
    });

    it('should sanitize formula prefixes with a leading single quote', () => {
        const rows: TestRow[] = [
            { id: '1', name: '=SUM(A1)', score: 1 },
            { id: '2', name: '+cmd', score: 2 },
            { id: '3', name: '-data', score: 3 },
            { id: '4', name: '@import', score: 4 },
        ];
        const result = toCSV(rows, columns);
        expect(result).toBe(
            "ID,Name,Score\r\n1,'=SUM(A1),1\r\n2,'+cmd,2\r\n3,'-data,3\r\n4,'@import,4\r\n",
        );
    });
});

describe('toTSV', () => {
    it('should produce tab-delimited output', () => {
        const rows: TestRow[] = [
            { id: '1', name: 'Alice', score: 9.5 },
        ];
        const result = toTSV(rows, columns);
        expect(result).toBe('ID\tName\tScore\r\n1\tAlice\t9.5\r\n');
    });

    it('should replace tabs and newlines with spaces', () => {
        const rows: TestRow[] = [{ id: '1', name: 'a\tb\nc', score: 1 }];
        const result = toTSV(rows, columns);
        expect(result).toBe('ID\tName\tScore\r\n1\ta b c\t1\r\n');
    });

    it('should return header-only for empty rows', () => {
        const result = toTSV([], columns);
        expect(result).toBe('ID\tName\tScore\r\n');
    });

    it('should sanitize formula prefixes with a leading single quote', () => {
        const rows: TestRow[] = [
            { id: '1', name: '=SUM(A1)', score: 1 },
            { id: '2', name: '@import', score: 2 },
        ];
        const result = toTSV(rows, columns);
        expect(result).toBe("ID\tName\tScore\r\n1\t'=SUM(A1)\t1\r\n2\t'@import\t2\r\n");
    });
});
