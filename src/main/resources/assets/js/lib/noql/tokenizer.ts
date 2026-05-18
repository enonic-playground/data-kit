import type { Position, Token, ValidationError } from './types';

const KEYWORDS = new Set([
  'AND',
  'OR',
  'NOT',
  'LIKE',
  'IN',
  'ASC',
  'DESC',
  'ORDER',
  'BY',
  'COLLATE',
]);

const IDENT_START = /[a-zA-Z_*@]/;
const IDENT_REST = /[a-zA-Z0-9\-_/.*@]/;
const DIGIT = /[0-9]/;

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

export function tokenize(input: string): Token[] | ValidationError {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    if (isWhitespace(ch)) {
      i++;
      continue;
    }

    // * String literal
    if (ch === "'" || ch === '"') {
      const start = i;
      const quote = ch;
      i++;
      while (i < len && input[i] !== quote) i++;
      if (i >= len) {
        return {
          message: `Unterminated string starting at position ${start}`,
          position: { start, end: len },
        };
      }
      i++; // consume closing quote
      tokens.push({
        type: 'string',
        value: input.slice(start + 1, i - 1),
        position: { start, end: i },
      });
      continue;
    }

    // * Number literal (optionally signed, followed by a digit)
    if (DIGIT.test(ch) || ((ch === '-' || ch === '+') && i + 1 < len && DIGIT.test(input[i + 1]))) {
      const start = i;
      if (ch === '-' || ch === '+') i++;
      while (i < len && DIGIT.test(input[i])) i++;
      if (i < len && input[i] === '.') {
        i++;
        const fracStart = i;
        while (i < len && DIGIT.test(input[i])) i++;
        if (i === fracStart) {
          return {
            message: `Malformed number at position ${start}`,
            position: { start, end: i },
          };
        }
      }
      tokens.push({
        type: 'number',
        value: input.slice(start, i),
        position: { start, end: i },
      });
      continue;
    }

    // * Identifier or keyword
    if (IDENT_START.test(ch)) {
      const start = i;
      i++;
      while (i < len && IDENT_REST.test(input[i])) i++;
      const raw = input.slice(start, i);
      const upper = raw.toUpperCase();
      const position: Position = { start, end: i };
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', value: upper, position });
      } else {
        tokens.push({ type: 'identifier', value: raw, position });
      }
      continue;
    }

    // * Parentheses and comma
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(', position: { start: i, end: i + 1 } });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')', position: { start: i, end: i + 1 } });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',', position: { start: i, end: i + 1 } });
      i++;
      continue;
    }

    // * Comparison operators
    if (ch === '=') {
      tokens.push({ type: 'operator', value: '=', position: { start: i, end: i + 1 } });
      i++;
      continue;
    }
    if (ch === '!') {
      if (i + 1 < len && input[i + 1] === '=') {
        tokens.push({ type: 'operator', value: '!=', position: { start: i, end: i + 2 } });
        i += 2;
        continue;
      }
      return {
        message: `Invalid character '!' at position ${i} — expected '!='`,
        position: { start: i, end: i + 1 },
      };
    }
    if (ch === '>' || ch === '<') {
      if (i + 1 < len && input[i + 1] === '=') {
        tokens.push({
          type: 'operator',
          value: `${ch}=`,
          position: { start: i, end: i + 2 },
        });
        i += 2;
      } else {
        tokens.push({ type: 'operator', value: ch, position: { start: i, end: i + 1 } });
        i++;
      }
      continue;
    }

    return {
      message: `Invalid character '${ch}' at position ${i}`,
      position: { start: i, end: i + 1 },
    };
  }

  return tokens;
}
