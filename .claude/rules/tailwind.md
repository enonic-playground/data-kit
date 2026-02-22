# Tailwind CSS & Styling Standards

## Class Name Utilities

### `cn` — Default Choice

`cn` is a `clsx` + `tailwind-merge` utility for combining class names. Define or import it from a project utility file.

```typescript
// ✅ Use cn for most dynamic class combinations
const buttonClasses = cn(
  'px-4 py-2 rounded font-medium',
  disabled && 'opacity-50 cursor-not-allowed',
  variant === 'primary' && 'bg-blue-500 text-white',
  className,
);

// ✅ Use cn for simple conditional classes
<div className={cn('flex gap-2', isVertical && 'flex-col')} />

// ✅ When using `className` prop, pass it as the last argument in cn()
// This allows parent components to override styles
const classes = cn(
  'base-styles',
  condition && 'conditional-styles',
  className, // Last, so parent can override
);

// ❌ Don't place className before other classes - overrides won't work
const badClasses = cn(className, 'base-styles'); // Wrong order

// ❌ Don't use template literals for Tailwind classes
```

### `cva` — Only for Complex Variants

```typescript
// ✅ Use cva ONLY when you have 2+ variant dimensions with multiple options
const buttonVariants = cva('px-4 py-2 rounded font-medium transition-colors', {
  variants: {
    variant: {
      primary: 'bg-blue-500 text-white hover:bg-blue-600',
      secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
      ghost: 'bg-transparent hover:bg-gray-100',
      danger: 'bg-red-500 text-white hover:bg-red-600',
    },
    size: {
      sm: 'text-sm px-3 py-1',
      md: 'text-base px-4 py-2',
      lg: 'text-lg px-6 py-3',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'md',
  },
});

// ❌ DON'T use cva for simple true/false states
const badVariants = cva('base', {
  variants: {
    disabled: {
      true: 'opacity-50',
      false: '',
    },
  },
});
```

## Tailwind 4 Best Practices

### Spacing & Layout

```typescript
// ✅ Use size-* for equal width and height
<Icon className="size-4" /> // Not h-4 w-4
<Avatar className="size-10" /> // Not h-10 w-10

// ❌ Don't use separate h-* w-* when values are equal
<Icon className="h-4 w-4" /> // Use size-4 instead

// ✅ Consistent gap usage in flex/grid
<div className="flex gap-4" /> // Not space-x-4
```

### Responsive Design

```typescript
// ✅ Mobile-first approach
<div className="text-sm md:text-base lg:text-lg" />

// ❌ Don't mix breakpoint orders
<div className="lg:text-lg text-sm md:text-base" /> // Confusing order
```

### Performance Patterns

```typescript
// ✅ Extract repeated class combinations into cn() calls
const cardBase = 'rounded-lg border bg-card p-6 shadow-sm';

// ❌ Don't use @apply in component files - use cn() or cva()
// @apply should only be in CSS files for base styles
```

## Class Name Management

### When to Extract Classes to Variables

**Extract to variables when:**

```typescript
// ✅ Complex conditional logic
const buttonClasses = cn(
  'px-4 py-2 rounded font-medium transition-colors',
  variant === 'primary' && 'bg-blue-500 text-white hover:bg-blue-600',
  variant === 'secondary' && 'bg-gray-200 text-gray-900 hover:bg-gray-300',
  disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
  className,
);

// ✅ More than 6 classes on a single line, 4+ lines, or 80+ characters
const containerClasses = cn(
  'relative flex items-center justify-between',
  'gap-4 rounded-lg border border-gray-200',
  'bg-white p-6 shadow-sm',
  isActive && 'ring-2 ring-blue-500',
);

// ✅ Reused in multiple places (2+ uses) in the same file
const cardStyles = 'rounded-lg border bg-card p-6 shadow-sm';
```

**Keep inline when:**

```typescript
// ✅ Simple static classes (up to 5)
<div className="flex items-center gap-2" />

// ✅ Single simple condition
<button className={cn('px-4 py-2', disabled && 'opacity-50')} />
```

### Organization Patterns

**Decision framework:**

- Keep classes close to usage but after all logic
- Extract when readability suffers in JSX
- Extract when you start duplicating combinations
- Follow the flow: hooks → logic → styles → render

## Component Styling Patterns

### Base Component Structure

```typescript
export function Component({ className, ...props }: ComponentProps) {
  // ✅ Always allow className override as last argument
  return (
    <div
      className={cn(
        // Base styles first
        'relative flex items-center gap-2',
        // Conditional styles
        props.disabled && 'pointer-events-none select-none opacity-30',
        // User overrides last
        className,
      )}
      {...props}
    />
  );
}
```

### State Management with Data Attributes

```typescript
// ✅ Use data-* attributes for state-based styling
<li
  data-active={isActive}
  data-selected={isSelected}
  className="option data-[active=true]:bg-surface-neutral-hover data-[selected=true]:bg-surface-primary"
>
  Option
</li>

// ❌ Avoid complex class-based state selectors
<li className={cn('option', isActive && 'option-active', isSelected && 'option-selected')}>
  Option
</li>

// Why data-* attributes are better:
// - More declarative and readable
// - Better separation of state and styling
// - Easier to debug in DevTools
// - Simpler selector syntax
```

## Anti-patterns to Avoid

```typescript
// ❌ String concatenation for classes
<div className={'text-' + size} /> // Breaks Tailwind's compiler

// ❌ Conditional full class names in templates
<div className={`${active ? 'bg-blue-500 text-white' : 'bg-gray-200 text-black'}`} />
// ✅ Use cn() instead

// ❌ Mixing Tailwind with inline styles
<div className="p-4" style={{ margin: '10px' }} />

// ❌ Using important modifier everywhere
<div className="!p-4 !m-2 !text-center" /> // Fix specificity properly
```
