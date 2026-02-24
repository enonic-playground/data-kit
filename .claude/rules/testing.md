---
paths:
  - "src/test/**/*.test.ts"
---
# Testing Standards

## Test Structure

Tests are pure unit tests in a Node environment — no DOM, no component rendering. Use the Arrange-Act-Assert pattern.

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
// ✅ Test files live in src/test/**/*.test.ts
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

## Environment Notes

- **Runtime**: Node (no browser globals, no DOM)
- **Framework**: Vitest — use `vi` instead of `jest` for mocks and spies
- **No component testing**: `@testing-library/*` is not available; test logic directly
