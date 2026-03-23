# IronForge Admin — Design System

## Direction

**Personality**: Sophistication & Density — a command center for gym operators who need to see everything at a glance, act fast, and trust the data. The emotional quality is *controlled power*: dark, dense, confident, with gold precision highlights that reference the iron and brass of a serious gym.

**Foundation**: Cool-dark with warm gold accent. The darkness isn't decorative — it recedes so data comes forward. Gold isn't decorative — it marks what demands action.

**Depth Strategy**: Borders-only with surface color shifts. No shadows. Elevation is communicated through background lightness stepping: `#05070B` → `#0A0D14` → `#0F172A` → `#111827`. Borders at `white/6` to `white/10` define edges without demanding attention.

**Signature Element**: The left-border accent on stat cards — a 2px colored left edge that acts like a status indicator strip, borrowed from industrial control panels. This pattern should extend to any card that represents a KPI or status.

## Tokens

### Spacing
Base unit: **4px**
Scale: `4, 8, 12, 16, 20, 24, 32, 48, 64`
- Component internal padding: `16px` (cards), `12px` (compact cards), `8px` (table cells)
- Section gaps: `24px` between card groups, `16px` between related items
- Page padding: `24px` desktop, `16px` mobile

### Colors

**Surfaces (elevation order)**:
- `--surface-0`: `#05070B` — page canvas
- `--surface-100`: `#0A0D14` — sidebar, recessed areas
- `--surface-200`: `#0F172A` — cards, primary containers
- `--surface-300`: `#111827` — hover states, elevated panels
- `--surface-400`: `#1E293B` — dropdowns, popovers

**Foreground**:
- `--text-primary`: `#E5E7EB` — headings, values, primary content
- `--text-secondary`: `#9CA3AF` — labels, descriptions
- `--text-tertiary`: `#6B7280` — metadata, timestamps
- `--text-muted`: `#4B5563` — disabled, placeholder

**Brand & Semantic**:
- `--accent`: `#D4AF37` — gold, CTAs, active nav, primary actions
- `--accent-hover`: `#C4A030` — gold darkened for hover
- `--success`: `#10B981` — positive metrics, active status
- `--warning`: `#F59E0B` — caution, medium risk
- `--danger`: `#EF4444` — critical risk, destructive actions
- `--info`: `#60A5FA` — informational, links

**Borders**:
- `--border-subtle`: `rgba(255,255,255,0.06)` — card edges
- `--border-default`: `rgba(255,255,255,0.08)` — section dividers
- `--border-strong`: `rgba(255,255,255,0.10)` — hover states
- `--border-active`: `#D4AF37` — focused inputs, active elements

### Radius
Scale: `4px, 6px, 8px, 12px, 14px`
- Buttons: `8px`
- Cards: `14px`
- Inputs: `8px`
- Badges/pills: `6px`
- Modals: `14px`
- Tooltips: `8px`

### Typography
Font: `system-ui, -apple-system, sans-serif`
Mono: `'SF Mono', 'Fira Code', 'Consolas', monospace` (for data/numbers)

Scale:
- `11px` — metadata, timestamps
- `12px` — labels, badges, table headers
- `13px` — nav items, secondary text, table cells
- `14px` — body text (base)
- `16px` — section headings
- `18px` — page sub-headings
- `24px` — stat values, page headings
- `32px` — hero numbers (overview KPIs)

Weights: `400` (body), `500` (labels, nav), `600` (headings, values), `700` (hero stats)

Numeric data: always `tabular-nums tracking-tight` for alignment.

## Patterns

### StatCard (KPI)
- Height: auto
- Padding: `16px`
- Background: `surface-200`
- Border: `1px solid border-subtle`
- Border-left: `2px solid {status-color}` — color indicates category
- Radius: `14px`
- Hover: `border-strong`, `surface-300`
- Value: `24px`, `font-bold`, `text-primary`, `tabular-nums`
- Label: `12px`, `text-secondary`
- Sub-label: `11px`, `text-tertiary`
- Transition: `all 300ms`

### Card (Container)
- Padding: `16px` standard, `24px` spacious
- Background: `surface-200`
- Border: `1px solid border-subtle`
- Radius: `14px`
- No shadow

### Table
- Header: `12px`, `font-medium`, `text-tertiary`, `uppercase`, `tracking-wider`
- Cell padding: `12px 16px`
- Row border: `1px solid border-subtle`
- Row hover: `surface-300`
- Values: `13px`, `tabular-nums` for numbers

### Button Primary
- Height: `36px`
- Padding: `8px 16px`
- Background: `accent`
- Text: `#000` (dark on gold)
- Radius: `8px`
- Font: `13px`, `font-medium`
- Hover: `accent-hover`

### Button Secondary
- Height: `36px`
- Padding: `8px 16px`
- Background: `transparent`
- Border: `1px solid border-default`
- Text: `text-secondary`
- Radius: `8px`
- Hover: `surface-300`, `text-primary`

### Badge / Risk Tier
- Padding: `2px 8px`
- Radius: `6px`
- Font: `11px`, `font-semibold`
- Colors by tier:
  - Critical: `bg-red-500/15 text-red-400`
  - High: `bg-orange-500/15 text-orange-400`
  - Medium: `bg-yellow-500/15 text-yellow-400`
  - Low: `bg-emerald-500/15 text-emerald-400`

### Modal
- Backdrop: `bg-black/60 backdrop-blur-sm`
- Container: `surface-200`, `border border-subtle`, `rounded-[14px]`
- Max-width: `480px` (small), `640px` (medium), `800px` (large)
- Header padding: `20px 24px`
- Body padding: `0 24px 24px`
- Close button: top-right, `text-tertiary`, hover `text-primary`

### Sidebar Nav Item
- Padding: `8px 12px`
- Font: `13px`, `font-medium`
- Inactive: `text-tertiary`, hover `text-secondary`
- Active: `text-accent`, `bg-white/[0.03]`, left `2px` accent bar
- Radius: `8px`

### Input
- Height: `36px`
- Padding: `8px 12px`
- Background: `surface-100` (inset feel)
- Border: `1px solid border-subtle`
- Radius: `8px`
- Focus: `border-active`, `ring-1 ring-accent/20`
- Font: `14px`
- Placeholder: `text-muted`

### Chart (Recharts)
- Background: transparent (card provides surface)
- Grid lines: `border-subtle`
- Axis labels: `11px`, `text-tertiary`
- Tooltip: `surface-300`, `border border-subtle`, `rounded-lg`
- Area fill: gradient from accent at 20% opacity to transparent
- Line stroke: `accent` or semantic color, `2px`

## Rationale

**Why borders-only?** This is a data-dense admin panel. Shadows add visual noise that competes with the actual data. Borders define structure; color shifts communicate hierarchy. The admin needs to scan 50+ data points on a single screen — every pixel of visual weight should serve the data, not decoration.

**Why gold accent?** Gold reads as premium and authoritative without being corporate-blue-generic. It connects to the product's gym/iron/forge identity. Against the dark surfaces, gold has excellent contrast and draws the eye precisely where action is needed.

**Why 4px base?** Admin interfaces need density. An 8px base creates too much whitespace for data tables and stat grids. 4px gives us fine-grained control: `4px` for tight gaps, `8px` for breathing room, `16px` for card padding, `24px` for section separation.
