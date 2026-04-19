import { closestName } from './suggest';
import { tokenize } from './tokenizer';
import type { Token, ValidationError } from './types';

type RangeArity = { min: number; max: number };
type FunctionCategory = 'value' | 'constraint' | 'sort';

const VALUE_FUNCTIONS: Record<string, number> = {
    geoPoint: 1,
    instant: 1,
    dateTime: 1,
    localDateTime: 1,
    time: 1,
    date: 1,
};

const CONSTRAINT_FUNCTIONS: Record<string, RangeArity> = {
    fulltext: { min: 2, max: 4 },
    ngram: { min: 2, max: 4 },
    stemmed: { min: 2, max: 4 },
    range: { min: 3, max: 5 },
    pathMatch: { min: 2, max: 3 },
};

const SORT_FUNCTIONS: Record<string, number | RangeArity> = {
    score: 0,
    geoDistance: { min: 2, max: 3 },
};

const ALL_FUNCTION_NAMES = [
    ...Object.keys(VALUE_FUNCTIONS),
    ...Object.keys(CONSTRAINT_FUNCTIONS),
    ...Object.keys(SORT_FUNCTIONS),
];

class ParseError extends Error {
    constructor(readonly error: ValidationError) {
        super(error.message);
    }
}

class Parser {
    private i = 0;
    constructor(private readonly tokens: Token[]) {}

    private peek(offset = 0): Token | undefined {
        return this.tokens[this.i + offset];
    }

    private consume(): Token {
        const t = this.tokens[this.i];
        this.i++;
        return t;
    }

    private isEof(): boolean {
        return this.i >= this.tokens.length;
    }

    private matchKeyword(kw: string): boolean {
        const t = this.peek();
        return t?.type === 'keyword' && t.value === kw;
    }

    parseQuery(): void {
        if (this.isEof()) return;

        if (this.matchKeyword('ORDER')) {
            this.parseOrderBy();
        } else {
            this.parseConstraint();
            if (this.matchKeyword('ORDER')) {
                this.parseOrderBy();
            }
        }

        if (!this.isEof()) {
            const t = this.peek();
            if (t != null) {
                throw new ParseError({
                    message: `Unexpected token '${t.value}' at position ${t.position.start}`,
                    position: t.position,
                });
            }
        }
    }

    private parseConstraint(): void {
        this.parseAndExpr();
        while (this.matchKeyword('OR')) {
            this.consume();
            this.parseAndExpr();
        }
    }

    private parseAndExpr(): void {
        this.parseNotExpr();
        while (this.matchKeyword('AND')) {
            this.consume();
            this.parseNotExpr();
        }
    }

    private parseNotExpr(): void {
        if (this.matchKeyword('NOT')) {
            this.consume();
            this.parseNotExpr();
            return;
        }
        this.parseUnit();
    }

    private parseUnit(): void {
        const t = this.peek();
        if (t == null) {
            throw new ParseError({ message: 'Incomplete expression' });
        }
        if (t.type === 'lparen') {
            this.consume();
            this.parseConstraint();
            const rp = this.peek();
            if (rp == null || rp.type !== 'rparen') {
                throw new ParseError({
                    message: `Expected ')' to close '(' at position ${t.position.start}`,
                    position: t.position,
                });
            }
            this.consume();
            return;
        }
        if (t.type === 'identifier') {
            if (this.peek(1)?.type === 'lparen') {
                this.parseFunctionCall('constraint');
                return;
            }
            this.parseCompare();
            return;
        }
        throw new ParseError({
            message: `Unexpected token '${t.value}' at position ${t.position.start}`,
            position: t.position,
        });
    }

    private parseCompare(): void {
        const field = this.consume();
        const op = this.peek();
        if (op == null) {
            throw new ParseError({
                message: `Incomplete expression after '${field.value}'`,
                position: field.position,
            });
        }
        if (op.type === 'operator') {
            this.consume();
            this.parseValue();
            return;
        }
        if (op.type === 'keyword') {
            if (op.value === 'LIKE') {
                this.consume();
                this.parseValue();
                return;
            }
            if (op.value === 'IN') {
                this.consume();
                this.parseValueList();
                return;
            }
            if (op.value === 'NOT') {
                this.consume();
                const next = this.peek();
                if (next == null || next.type !== 'keyword' || (next.value !== 'LIKE' && next.value !== 'IN')) {
                    throw new ParseError({
                        message: `Expected 'LIKE' or 'IN' after 'NOT' at position ${op.position.start}`,
                        position: op.position,
                    });
                }
                this.consume();
                if (next.value === 'LIKE') this.parseValue();
                else this.parseValueList();
                return;
            }
        }
        throw new ParseError({
            message: `Expected operator after '${field.value}' at position ${op.position.start}`,
            position: op.position,
        });
    }

    private parseValue(): void {
        const t = this.peek();
        if (t == null) {
            throw new ParseError({ message: 'Incomplete expression — expected a value' });
        }
        if (t.type === 'string' || t.type === 'number') {
            this.consume();
            return;
        }
        if (t.type === 'identifier' && this.peek(1)?.type === 'lparen') {
            this.parseFunctionCall('value');
            return;
        }
        throw new ParseError({
            message: `Expected a value at position ${t.position.start}`,
            position: t.position,
        });
    }

    private parseValueList(): void {
        const lp = this.peek();
        if (lp == null || lp.type !== 'lparen') {
            throw new ParseError({
                message: `Expected '(' to start value list`,
                position: lp?.position,
            });
        }
        this.consume();
        this.parseValue();
        while (this.peek()?.type === 'comma') {
            this.consume();
            this.parseValue();
        }
        const rp = this.peek();
        if (rp == null || rp.type !== 'rparen') {
            throw new ParseError({
                message: `Expected ')' to close '(' at position ${lp.position.start}`,
                position: lp.position,
            });
        }
        this.consume();
    }

    private parseFunctionCall(category: FunctionCategory): void {
        const name = this.consume();
        const lp = this.consume();
        let argCount = 0;
        if (this.peek()?.type !== 'rparen') {
            this.parseFunctionArg();
            argCount++;
            while (this.peek()?.type === 'comma') {
                this.consume();
                this.parseFunctionArg();
                argCount++;
            }
        }
        const rp = this.peek();
        if (rp == null || rp.type !== 'rparen') {
            throw new ParseError({
                message: `Expected ')' to close '(' at position ${lp.position.start}`,
                position: lp.position,
            });
        }
        this.consume();
        this.validateFunctionSemantics(name, argCount, category);
    }

    private parseFunctionArg(): void {
        const t = this.peek();
        if (t == null) {
            throw new ParseError({ message: 'Incomplete function argument' });
        }
        if (t.type === 'string' || t.type === 'number') {
            this.consume();
            return;
        }
        if (t.type === 'identifier') {
            if (this.peek(1)?.type === 'lparen') {
                this.parseFunctionCall('value');
                return;
            }
            this.consume();
            return;
        }
        throw new ParseError({
            message: `Expected a value at position ${t.position.start}`,
            position: t.position,
        });
    }

    private parseOrderBy(): void {
        this.consume(); // ORDER
        const by = this.peek();
        if (by == null || by.type !== 'keyword' || by.value !== 'BY') {
            throw new ParseError({
                message: `Expected 'BY' after 'ORDER'`,
                position: by?.position,
            });
        }
        this.consume();
        this.parseOrderElement();
        while (this.peek()?.type === 'comma') {
            this.consume();
            this.parseOrderElement();
        }
    }

    private parseOrderElement(): void {
        const t = this.peek();
        if (t == null) {
            throw new ParseError({ message: `Expected field or function in ORDER BY` });
        }
        if (t.type !== 'identifier') {
            throw new ParseError({
                message: `Expected field or function in ORDER BY at position ${t.position.start}`,
                position: t.position,
            });
        }
        if (this.peek(1)?.type === 'lparen') {
            this.parseFunctionCall('sort');
        } else {
            this.consume();
        }
        if (this.matchKeyword('ASC') || this.matchKeyword('DESC')) {
            this.consume();
        }
        if (this.matchKeyword('COLLATE')) {
            this.consume();
            const s = this.peek();
            if (s == null || s.type !== 'string') {
                throw new ParseError({
                    message: `Expected a string literal after 'COLLATE'`,
                    position: s?.position,
                });
            }
            this.consume();
        }
    }

    private validateFunctionSemantics(name: Token, argCount: number, category: FunctionCategory): void {
        const nameStr = name.value;
        const valueArity = VALUE_FUNCTIONS[nameStr];
        const constraintArity = CONSTRAINT_FUNCTIONS[nameStr];
        const sortArity = SORT_FUNCTIONS[nameStr];

        const isValue = valueArity != null;
        const isConstraint = constraintArity != null;
        const isSort = sortArity != null;

        if (!((isValue || isConstraint ) || isSort)) {
            const suggestion = closestName(nameStr, ALL_FUNCTION_NAMES);
            throw new ParseError({
                message: `Unknown function '${nameStr}'`,
                position: name.position,
                suggestion: suggestion != null ? `Did you mean '${suggestion}'?` : undefined,
            });
        }

        const correctCategory =
            (category === 'value' && isValue) ||
            (category === 'constraint' && isConstraint) ||
            (category === 'sort' && isSort);

        if (!correctCategory) {
            const sourceLabel = isValue ? 'a value function' : isConstraint ? 'a constraint function' : 'an ORDER BY function';
            const destLabel = category === 'value' ? 'a value' : category === 'constraint' ? 'a constraint' : 'ORDER BY';
            throw new ParseError({
                message: `${nameStr}() is ${sourceLabel} and cannot be used as ${destLabel}`,
                position: name.position,
            });
        }

        if (category === 'value') {
            if (argCount !== valueArity) {
                throw new ParseError({
                    message: formatArityMessage(nameStr, valueArity, argCount),
                    position: name.position,
                });
            }
            return;
        }

        if (category === 'constraint') {
            const { min, max } = constraintArity;
            if (argCount < min || argCount > max) {
                throw new ParseError({
                    message: formatArityMessage(nameStr, { min, max }, argCount),
                    position: name.position,
                });
            }
            return;
        }

        if (typeof sortArity === 'number') {
            if (argCount !== sortArity) {
                throw new ParseError({
                    message: formatArityMessage(nameStr, sortArity, argCount),
                    position: name.position,
                });
            }
            return;
        }

        const { min, max } = sortArity;
        if (argCount < min || argCount > max) {
            throw new ParseError({
                message: formatArityMessage(nameStr, { min, max }, argCount),
                position: name.position,
            });
        }
    }
}

function formatArityMessage(name: string, expected: number | RangeArity, got: number): string {
    if (typeof expected === 'number') {
        const word = expected === 1 ? 'argument' : 'arguments';
        return `${name}() takes ${expected} ${word}, got ${got}`;
    }
    const range = expected.min === expected.max ? `${expected.min}` : `${expected.min}\u2013${expected.max}`;
    return `${name}() takes ${range} arguments, got ${got}`;
}

export function validate(query: string): ValidationError | null {
    const tokenResult = tokenize(query);
    if (!Array.isArray(tokenResult)) return tokenResult;
    if (tokenResult.length === 0) return null;

    const parser = new Parser(tokenResult);
    try {
        parser.parseQuery();
        return null;
    } catch (e) {
        if (e instanceof ParseError) return e.error;
        throw e;
    }
}
