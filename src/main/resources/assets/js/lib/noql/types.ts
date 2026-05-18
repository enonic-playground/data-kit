export type Position = {
  start: number;
  end: number;
};

export type TokenType =
  | 'identifier'
  | 'string'
  | 'number'
  | 'keyword'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma';

export type Token = {
  type: TokenType;
  value: string;
  position: Position;
};

export type ValidationError = {
  message: string;
  position?: Position;
  suggestion?: string;
};
