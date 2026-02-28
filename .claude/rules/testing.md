---
paths:
  - "src/test/**/*.test.ts"
  - "src/test/**/*.test.tsx"
---
# Testing Standards

## Test Structure

Use the Arrange-Act-Assert pattern for all tests.

```typescript
import { describe, it, expect, vi } from 'vitest';

// ✅ Arrange-Act-Assert pattern
describe('userService', () => {
  describe('createUser', () => {
    it('should create user with valid data', async () => {
      // Arrange
      const userData: UserData = {
        email: 'test@example.com',
        password: 'securePass123!',
        firstName: 'John',
        lastName: 'Doe',
      };
      const mockUser = { id: 'user_123', ...userData };
      vi.spyOn(userRepository, 'create').mockResolvedValue(mockUser);

      // Act
      const result = await userService.createUser(userData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        id: expect.stringMatching(/^user_/),
        email: userData.email,
      });
    });
  });
});
```

## Builder Pattern for Test Data

Use builder functions (factory functions with overrides) to construct test data. Prefer specific helpers over generic factories.

```typescript
// ✅ Builder with sensible defaults and optional overrides
function buildFormValue(overrides?: Partial<FormValue>): FormValue {
  return {
    value: '',
    dirty: false,
    valid: true,
    ...overrides,
  };
}
```

## Mock Patterns

```typescript
import { vi } from 'vitest';

// ✅ Spy on methods for assertion
vi.spyOn(service, 'method').mockReturnValue(expectedResult);

// ✅ Reset mocks between tests when needed
beforeEach(() => {
  vi.clearAllMocks();
});

// ✅ Use vi.fn() for callback assertions
const onChangeMock = vi.fn();
callFunctionUnderTest(onChangeMock);
expect(onChangeMock).toHaveBeenCalledWith(expectedArg);
```

## Test File Conventions

```typescript
// ✅ Test files live in src/test/**/*.test.{ts,tsx}
// ✅ One describe block per module/class
// ✅ Nested describe for method/function grouping
// ✅ Test names start with 'should'

describe('ClassName', () => {
  describe('methodName', () => {
    it('should return expected value for valid input', () => { /* ... */ });
    it('should throw when input is null', () => { /* ... */ });
    it('should handle edge case correctly', () => { /* ... */ });
  });
});
```

## Component Testing

Component tests use `@testing-library/react` with jsdom. Each test file must opt in with a per-file annotation.

### Environment annotation

```typescript
// @vitest-environment jsdom
```

Place this comment on the first line of every `.test.tsx` file. Existing `.test.ts` files run in `node` by default.

### Render through the router

Use `renderRoute()` from `test-utils.tsx` to render the full app at a given URL. This tests the real integration: loaders, suspense, data flow.

```typescript
import { renderRoute, screen, waitFor } from '../test-utils';

it('should render page content', async () => {
  renderRoute({ initialLocation: '/system' });

  await waitFor(() => {
    expect(screen.getByText('expected text')).toBeInTheDocument();
  });
});
```

### Mock strategy

Mock two functions to control all data without touching component internals:

- **`apiFetch`** — all API calls funnel through this. Mock at the module level with `vi.mock()`.
- **`getConfig`** — reads config from DOM. Mock to return a `DataKitConfig` object.

```typescript
vi.mock('../../../../main/resources/assets/js/lib/api/client', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => buildConfig()),
}));
```

### Query priority

Follow Testing Library's query priority:
1. `getByRole` — accessible queries first
2. `getByText` — visible text
3. `getByLabelText` — form elements

### User interaction

```typescript
const { user } = renderRoute({ initialLocation: '/repositories' });
await user.click(screen.getByRole('button', { name: /create/i }));
```

`renderRoute()` returns `{ user }` from `userEvent.setup()`.

## Environment Notes

- **Default runtime**: Node (no browser globals, no DOM) — for server-side and utility tests
- **jsdom runtime**: Opt-in per file with `// @vitest-environment jsdom` — for component tests
- **Framework**: Vitest — use `vi` instead of `jest` for mocks and spies
- **DOM setup**: `src/test/setup-dom.ts` provides `@testing-library/jest-dom` matchers, `matchMedia` mock, and `ResizeObserver` mock
