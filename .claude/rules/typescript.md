---
paths:
  - "**/*.{ts,tsx}"
---
# TypeScript Coding Standards

## Code Style

```typescript
// ✅ Check for both null and undefined with `!= null`
if (response != null) {
  // safe to use response
}

// ❌ No nested ternaries - use if/else or object lookup
const status = isLoading ? 'loading' : isError ? 'error' : 'idle'; // Bad

// ✅ Good alternatives
const status = getStatus(); // Extract to function with if/else, switch/case or object lookup
const statusMap = { loading: isLoading, error: isError };

// ✅ Leverage modern TypeScript syntax
const len = items?.length ?? 0;
settings.debug ||= false;
cache?.clear();
const size = 1_000;

// ✅ Prefer destructing assignment
const [body, headers = {}] = request;
const { signal } = new AbortController();

// ✅ Prefer single-line guard clauses (early return)
if (element == null) return;
if (!isSupported) return false;

// ❌ Do not wrap single-statement guard clauses in braces
if (data == null) {
  return;
}
if (!isEnabled) {
  return children;
}

// ✅ Insert exactly one blank line between logically distinct operations
const result = doSomething();

updateAnotherThing();
```

## Naming Standards

```typescript
// ✅ All stores must start with `$` sign
export const $counter = atom(0);

// ✅ Standalone booleans use `is`/`has`/`can`/`should`/`will` prefixes
const isEnabled = true;
const hasFocus = false;
const canEdit = permissions.includes('edit');
const shouldUpdate = version < latest;
const willUnmount = false;

// ✅ Object props: drop prefixes for boolean props
const enabled = true;
const state = { enabled };

// ✅ React props: drop prefixes for boolean props
interface ButtonProps {
  disabled?: boolean; // Not 'isDisabled'
  loading?: boolean; // Not 'isLoading'
  active?: boolean; // Not 'isActive'
  onClick?: () => void; // Event handlers use 'on' prefix
  onChange?: (value: string) => void;
}

// ✅ Internal handlers use 'handle' prefix
const handleClick = () => {
  onClick?.();
};
const handleSubmit = (e: FormEvent) => {
  e.preventDefault();
};

// ✅ Use standard prop names
interface InputProps {
  value?: string; // Not 'text' or 'content'
  defaultValue?: string; // Not 'initialText'
  onChange?: (value: string) => void; // Not 'onUpdate'
}

// ✅ Arrays use plural forms
const users: User[] = [];
const selectedIds: string[] = [];

// ✅ Functions use verb prefixes
function getUserById(id: string) {} // get/fetch/load/parse
function setUserName(name: string) {} // set/update/save/calc/compute
function isValidEmail(email: string) {} // is/has for boolean returns

// ❌ Avoid unprefixed standalone flags or prefixed props
const enabledFlag = true; // Bad for standalone
const config = { isEnabled }; // Bad for object prop

// ✅ Add comma after the last element in multi-line function arguments, arrays, objects
function add(
  firstNumericValue: number,
  secondNumericValue: number,
  thirdNumericValue: number,
  fourthNumericValue: number,
): number {
  // ...
}

// ✅ Name constants using UPPERCASE and underscore
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
```

## Type Definitions

```typescript
// ✅ Prefer types for object shapes
type User = {
  id: string;
  name: string;
}

// ✅ Use type aliases for unions/primitives
type UserStatus = 'active' | 'inactive' | 'pending';
type UserId = string;

// ✅ Use T[] syntax for arrays
type Users = User[];
const items: string[] = [];

// ❌ Avoid Array<T> generic syntax
type Users = Array<User>; // Bad
const items: Array<string> = []; // Bad

// ❌ Avoid any type
const data: any = fetchData(); // Bad

// ✅ Use unknown and type guards
const data: unknown = fetchData();
if (isUser(data)) {
  // TypeScript knows data is User here
}

// ❌ Avoid type assertions with 'as' - use type guards or proper typing
const user = {} as User; // Bad
const element = event.target as HTMLInputElement; // Bad
// ✅ Good alternatives
const user: Partial<User> = {};
if (event.target instanceof HTMLInputElement) { /* use target */ }

// ❌ Avoid non-null assertion '!' - use optional chaining or guards
const value = getUserInput()!; // Bad
// ✅ Good alternatives
const value = getUserInput() ?? defaultValue;
if (!input) return; // Guard clause

// ✅ Prefer defining type separately instead of setting its shape in generics
type Identifiable = { id: string; }
function getById<T extends Identifiable>(items: T[], id: string): T {
  return items.find(item => item.id === id);
}

// ✅ Explicit type annotation when assigning objects
const user: User = { id, name };

// ✅ Use `satisfies` for precise literal types without widening
const options = {
  retry: 3,
  timeout: 5000,
} satisfies RequestOptions;

// ✅ Define and use `Maybe<T>` for nullish values
type Maybe<T> = T | null | undefined;
function findUser(id: string): Maybe<User> {
  // ...
}

// ✅ Prefer `undefined` over `null` for unset values (refs are the exception)
const [activeId, setActiveId] = useState<string | undefined>(undefined);
const context = createContext<MenuContextValue | undefined>(undefined);
const ref = useRef<HTMLDivElement | null>(null); // refs use null by convention
```

- Prefer one file per type
- Define types in the same file if one type is used inside another

## Type Composition

```typescript
// ✅ Use regular imports for types
import { MenuContextOperations } from '../primitives/menu-primitive';

export type MenuItemProps = Omit<MenuPrimitiveItemProps, keyof MenuContextOperations>;

// ❌ Avoid inline/dynamic type imports - harder to read and refactor
export type MenuItemPropsBad = Omit<
  MenuPrimitiveItemProps,
  keyof import('../primitives/menu-primitive').MenuContextOperations
>;

// ✅ Prefer composition: define base "own" types, then extend
type MenuItemOwnProps = {
  id?: string;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
} & ComponentPropsWithoutRef<'div'>;

// Internal type combines base + injected dependencies
type MenuPrimitiveItemProps = MenuItemOwnProps & MenuContextOperations;

// Consumer type uses base directly - clean and readable
export type MenuItemProps = MenuItemOwnProps;

// ❌ Avoid subtracting types that were just added (Omit gymnastics)
type FullProps = BaseProps & InjectedDeps;
export type PublicProps = Omit<FullProps, keyof InjectedDeps>; // Bad - just use BaseProps

// ❌ Especially avoid nested Omit - very hard to understand
export type RadioItemProps = Omit<
  PrimitiveRadioItemProps,
  keyof Omit<MenuContextOperations, 'setOpen'>
>; // Bad

// ✅ Instead, define what you need directly (single-level Omit is fine)
type RadioItemOwnProps = { value: string; disabled?: boolean; /* ... */ };
type PrimitiveRadioItemProps = RadioItemOwnProps & Omit<MenuContextOperations, 'setOpen'>;
export type RadioItemProps = RadioItemOwnProps; // Clean
```

**Rationale:**
- Composition (`Base & Extensions`) is clearer than subtraction (`Full - Removed`)
- IDE hover shows actual properties instead of computed `Omit<...>` types
- Nested `Omit<X, keyof Omit<Y, 'z'>>` is a code smell — restructure the types

## Import/Export Standards

```typescript
// ✅ Named exports preferred; no default exports from component files
export { UserService, ProductService };

// ✅ Group imports: external → internal → types; use relative paths within project
import React, { useState, useEffect } from 'react';

import { UserService } from '../services/UserService';

import type { User, CreateUserInput } from '../types';
```
