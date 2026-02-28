# UI Design Specification

Extracted from the reference design (`data-kit-dashboard.jsx`). This document defines the target look and feel for the data-kit admin tool UI migration.

## Fonts

- **UI font**: `'Inter', system-ui, sans-serif` — weights 300, 400, 500, 600, 700
- **Mono font**: `'JetBrains Mono', monospace` — weights 400, 500, 600
- Loaded via Google Fonts or bundled. Applied to all `button` and `input` elements.

## Color Palette

### Dark Theme

| Token        | Hex                        | Usage                                      |
|-------------|----------------------------|----------------------------------------------|
| `bg`         | `#0c0c0e`                  | Page background                              |
| `surface`    | `#111114`                  | Sidebar, header, cards                       |
| `surface-el` | `#17171b`                  | Elevated surfaces (table headers, inputs)    |
| `border`     | `#232328`                  | Default borders                              |
| `border-acc` | `#2e2e36`                  | Accented borders (active filters)            |
| `text`       | `#f0f0f4`                  | Primary text                                 |
| `text-sub`   | `#8888a0`                  | Secondary text (paths, timestamps)           |
| `text-muted` | `#44445a`                  | Muted text (placeholders, column headers)    |
| `accent`     | `#e63946`                  | Accent color (red) — active states, status bar |
| `accent-dim` | `#1e1214`                  | Dimmed accent (selected row background)      |
| `success`    | `#22c55e`                  | Success indicators                           |
| `warning`    | `#f59e0b`                  | Warning indicators                           |
| `info`       | `#3b82f6`                  | Info indicators                              |
| `tag`        | `#1e1e26`                  | Badge/tag background                         |
| `tag-text`   | `#7070a0`                  | Badge/tag text                               |
| `row-hover`  | `rgba(255,255,255,0.045)`  | Row hover background                        |
| `nav-active` | `#1e1e26`                  | Active nav item background                   |

### Light Theme

| Token        | Hex          | Usage                                      |
|-------------|--------------|----------------------------------------------|
| `bg`         | `#f2f2f5`    | Page background (light gray, NOT white)      |
| `surface`    | `#ffffff`    | Sidebar, header, cards                       |
| `surface-el` | `#f7f7fa`    | Elevated surfaces                            |
| `border`     | `#e4e4ec`    | Default borders                              |
| `border-acc` | `#c8c8da`    | Accented borders                             |
| `text`       | `#111118`    | Primary text                                 |
| `text-sub`   | `#5a5a72`    | Secondary text                               |
| `text-muted` | `#aaaabc`    | Muted text                                   |
| `accent`     | `#e63946`    | Accent (same red in both themes)             |
| `accent-dim` | `#fef2f3`    | Dimmed accent                                |
| `success`    | `#16a34a`    | Success                                      |
| `warning`    | `#d97706`    | Warning                                      |
| `info`       | `#2563eb`    | Info                                         |
| `tag`        | `#ebebf2`    | Badge/tag background                         |
| `tag-text`   | `#5a5a72`    | Badge/tag text                               |
| `row-hover`  | `#f0f0f6`    | Row hover background                        |
| `nav-active` | `#ebebf6`    | Active nav item background                   |

## Layout

### Overall Structure

```
┌──────────────────────────────────────────────────────┐
│ Sidebar │ Header (48px): section title + theme toggle│
│ (196px) │────────────────────────────────────────────│
│         │ Content area (flex-1, scrollable)           │
│         │                                            │
│         │  [breadcrumb toolbar if applicable]         │
│         │  [table / section content]                  │
│         │                                            │
│         │                      │ Preview (400px)      │
├─────────┴──────────────────────┴─────────────────────┤
│ Status bar (22px, accent-bg, white text)             │
└──────────────────────────────────────────────────────┘
```

### Sidebar

- **Expanded width**: 196px
- **Collapsed width**: 44px
- **Transition**: `width 0.18s cubic-bezier(0.4, 0, 0.2, 1)`
- **Background**: `surface`
- **Border**: right border `border`
- **Header** (48px):
  - Logo: 20x20px rounded square (5px radius), `accent` color background
  - Brand name: "Data Kit", weight 700, 13px, letter-spacing -0.02em
  - Collapse button: `ChevronsLeft` / `ChevronsRight` icons (14px)
- **Nav items**:
  - Padding: `7px 10px`
  - Border radius: 5px
  - Gap: 9px between icon and label
  - Font: 13px, weight 400 (inactive) / 500 (active)
  - **Active state**: `nav-active` background, `text` color, icon gets `accent` color
  - **Inactive**: transparent bg, `text-sub` color, `text-muted` icon color
  - **Hover** (inactive): `row-hover` background
  - Margin between items: 1px

### Header Bar

- **Height**: 48px
- **Background**: `surface`
- **Border**: bottom border `border`
- **Left**: Section title — weight 600, 14px
- **Right**: Theme toggle button (sun/moon icon, 15px)

### Status Bar

- **Height**: 22px
- **Background**: `accent` (red `#e63946`)
- **Left**: Green dot (5px circle, `rgba(255,255,255,0.55)`) + context text (mono, 11px, `rgba(255,255,255,0.88)`)
- **Right**: Version info (mono, 10px, `rgba(255,255,255,0.45)`)

## Tables

### Table Headers

- **Background**: `surface-el`
- **Position**: sticky, top 0, z-index 1
- **Font**: 10px, weight 700, `text-muted` color
- **Letter spacing**: 0.08em
- **Text transform**: uppercase
- **Padding**: 7px 16px
- **Border**: bottom `border`

### Table Rows

- **Layout**: CSS grid with defined column widths
- **Min height**: 42px
- **Padding**: 0 16px
- **Border**: bottom `border`
- **Cursor**: pointer
- **Transition**: background 0.1s
- **Hover**: `row-hover` background
- **Active/Selected**: `accent-dim` background

### Row Content

- **Name column**: icon (13px) + monospace name (13px, `text` color)
- **Type column**: `TypeBadge` component
- **Modified column**: monospace, 12px, `text-sub` color
- **Action column**: eye icon + more dots icon (each 13px, `text-muted`, hover `text-sub`)
- **Primary action**: chevron right for folders, eye for files

### ".." Back Row

- Arrow left icon (13px) + ".." text in mono
- Same hover behavior as regular rows

## Components

### TypeBadge

- **Font**: monospace, 10px, weight 500
- **Letter spacing**: 0.04em
- **Padding**: 2px 7px
- **Border radius**: 4px
- **Background**: `tag`
- **Color**: `tag-text`
- **Display**: inline-block, white-space nowrap

### Breadcrumb Toolbar

- **Height**: 40px
- **Background**: `surface`
- **Border**: bottom `border`
- **Padding**: 0 16px left, 0 12px right
- **Crumbs**: monospace, 12px, `text-sub` color (inactive) / `text` + weight 500 (last crumb)
- **Separator**: chevron-right icon (11px, `text-muted`)
- **Right side**: "Create" button (outlined, 12px, icon + label)

### Preview Panel (Inline)

- **Width**: 400px
- **Position**: inline, right side of content area (NOT a sheet overlay)
- **Background**: `surface`
- **Border**: left border `border`
- **Header**:
  - Name: weight 600, 15px
  - Path: mono, 11px, `text-muted`
  - Close button: X icon (15px)
  - Action buttons (Duplicate, Delete) below name, 12px
- **Tabs**: 12px, weight 500, accent-colored bottom border for active tab
- **Content**: scrollable, tab-specific layouts

### Search Input

- **Container**: bordered box with `border`, `bg` background, 7px radius
- **Icon**: search icon (14px, `text-muted`)
- **Input**: 13px, `text` color, no border/outline
- **Clear button**: X icon when query present
- **Max width**: 460px

### Context Menu

- **Background**: `surface`
- **Border**: 1px solid `border`, 8px radius
- **Shadow**: `0 8px 32px rgba(0,0,0,0.28)`
- **Min width**: 162px
- **Padding**: 4px
- **Items**: 12px, icon (12px) + label, 6px 10px padding, 5px radius
- **Danger items**: `accent` color
- **Separators**: 1px `border` with 4px vertical margin

## Typography Summary

| Element           | Size | Weight | Font  | Color       |
|-------------------|------|--------|-------|-------------|
| Header title      | 14px | 600    | UI    | `text`      |
| Nav label         | 13px | 400/500| UI    | `text-sub`/`text` |
| Table header      | 10px | 700    | UI    | `text-muted`|
| Row name          | 13px | 400    | Mono  | `text`      |
| Row detail        | 12px | 400    | Mono  | `text-sub`  |
| Row path          | 11px | 400    | Mono  | `text-sub`  |
| Badge             | 10px | 500    | Mono  | `tag-text`  |
| Status bar        | 11px | 400    | Mono  | white/alpha |
| Breadcrumb        | 12px | 400/500| Mono  | `text-sub`/`text` |
| Button label      | 12px | 500    | UI    | `text`      |
| Preview panel name| 15px | 600    | UI    | `text`      |
| Preview path      | 11px | 400    | Mono  | `text-muted`|

## Icons

Using `lucide-react`. Default size 13-15px for nav/actions, 11-12px for small indicators.

**Icon mapping** (reference icon name → lucide-react):
- `db` → `Database`
- `search` → `Search`
- `camera` → `Camera`
- `hdd` → `HardDrive`
- `upload` → `Upload`
- `check` → `ClipboardCheck` (or `ListChecks`)
- `shield` → `Shield`
- `activity` → `Activity`
- `settings` → `Settings`
- `chevR` → `ChevronRight`
- `eye` → `Eye`
- `more` → `MoreHorizontal`
- `plus` → `Plus`
- `trash` → `Trash2`
- `copy` → `Copy`
- `x` → `X`
- `sun` → `Sun`
- `moon` → `Moon`
- `folder` → `Folder`
- `file` → `FileText`
- `download` → `Download`
- `edit` → `Pencil`
- `info` → `Info`
- `branch` → `GitBranch`
- `arrowL` → `ArrowLeft`
- `chevsL` → `ChevronsLeft`
- `chevsR` → `ChevronsRight`
- `filter` → `Filter`
- `code` → `Code`
- `zap` → `Zap`
- `alertC` → `AlertCircle`
- `checkC` → `CheckCircle`

## View Transitions

Minimal transitions for navigation inside the repository browser:

- **Row hover**: `transition: background 0.1s`
- **Sidebar collapse**: `transition: width 0.18s cubic-bezier(0.4, 0, 0.2, 1)`
- **Folder navigation**: subtle crossfade or slide transition when entering/exiting folders
- **Preview panel**: smooth open/close from right side

## Key Differences from Current UI

1. **Colors**: From shadcn neutral grays to blue-tinted grays with `#e63946` red accent
2. **Light theme bg**: `#f2f2f5` (light gray) instead of pure white
3. **Fonts**: Inter + JetBrains Mono instead of system defaults
4. **Layout**: Thinner header (48px vs 56px), smaller sidebar (196/44 vs 224/56)
5. **Status bar**: New — 22px red bar at bottom
6. **Preview panel**: Inline (400px beside table) instead of sheet overlay
7. **Table style**: Grid-based with uppercase sticky headers, not HTML table elements
8. **Breadcrumb**: Separate toolbar bar instead of inline in page header
9. **Nav active state**: Icon turns accent color, bg gets `nav-active`
10. **Badges**: Monospace, smaller, different color scheme
11. **No page title/description**: Just section name in header bar, no subtitle
