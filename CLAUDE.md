# Project Guidelines

## UI/UX Pro Max - Design Intelligence

> AI-powered design intelligence toolkit providing professional UI/UX guidelines.

---

## Rule Categories by Priority

### Priority 1 - CRITICAL

#### Accessibility Rules
- Color contrast minimum **4.5:1** for normal text
- Visible focus rings on all interactive elements
- Descriptive `alt` text for meaningful images
- `aria-label` for icon-only buttons
- Tab order must match visual order
- Form labels using `for` attribute

#### Touch & Interaction Rules
- Minimum **44x44px** touch targets
- Click/tap for primary interactions
- Button disabling during async operations
- Clear error messages positioned near problem areas
- `cursor-pointer` on ALL clickable elements

### Priority 2 - HIGH

#### Performance Rules
- WebP images with `srcset` and lazy loading
- Check `prefers-reduced-motion` media query
- Reserve space for async content to prevent layout jumping

#### Layout & Responsive Rules
- Viewport meta: `width=device-width, initial-scale=1`
- Minimum **16px** body text on mobile
- Content fits viewport width (no horizontal scroll)
- Z-index scale: 10, 20, 30, 50

### Priority 3 - MEDIUM

#### Typography Rules
- Line height **1.5-1.75** for body text
- Line length limited to **65-75 characters**
- Heading/body font personalities must match

#### Animation Rules
- Duration **150-300ms** for micro-interactions
- Prefer `transform`/`opacity` over `width`/`height`
- Skeleton screens or spinners for loading states

#### Style Selection Rules
- Style must match product type
- Consistency across all pages
- **SVG icons only** - never use emojis

### Priority 4 - LOW

#### Chart Rules
- Chart type matched to data type
- Accessible color palettes
- Table alternative provided for accessibility

---

## Professional UI Common Rules

### Icons & Visual Elements
- Use **SVG icons** (Heroicons, Lucide, Simple Icons) - NOT emojis
- Hover states must NOT shift layout
- Research official SVG logos from Simple Icons
- Consistent icon sizing: `24x24` viewBox with `w-6 h-6`

### Interaction & Cursor
- Add `cursor-pointer` to ALL clickable/hoverable elements
- Provide visual feedback on hover (color, shadow, border)
- Use smooth transitions: `transition-colors duration-200`

### Light/Dark Mode Contrast
- Light mode glass cards: `bg-white/80` or higher
- Light mode text: `#0F172A` (slate-900)
- Light mode muted text: `#475569` (slate-600) minimum
- Ensure borders visible in both modes

### Layout & Spacing
- Floating navbar with `top-4 left-4 right-4` spacing
- Account for fixed navbar height in content
- Use consistent max-width (same container size across pages)

---

## Pre-Delivery Checklist

### Visual Quality
- [ ] No emoji icons (use SVG)
- [ ] Consistent icon set usage
- [ ] Correct brand logos verified
- [ ] Hover states don't shift layout
- [ ] Theme colors used directly

### Interaction
- [ ] All clickable elements have `cursor-pointer`
- [ ] Clear hover visual feedback
- [ ] Smooth transitions (150-300ms)
- [ ] Visible focus states

### Light/Dark Mode
- [ ] Sufficient text contrast in light mode (4.5:1)
- [ ] Glass/transparent elements visible in both modes
- [ ] Borders visible in both modes

### Layout
- [ ] Proper spacing on floating elements
- [ ] No content hidden behind fixed navbars
- [ ] Responsive at: 375px, 768px, 1024px, 1440px
- [ ] No horizontal scroll on mobile

### Accessibility
- [ ] Alt text on all images
- [ ] Form inputs have labels
- [ ] Color not sole indicator
- [ ] `prefers-reduced-motion` respected

---

## Available Design Resources

### UI Styles (57+)
Glassmorphism, Claymorphism, Neumorphism, Minimalism, Brutalism, Skeuomorphism, Material Design, Flat Design, etc.

### Color Palettes (95+)
Organized by industry: SaaS, E-commerce, Healthcare, Finance, Education, Entertainment, etc.

### Font Pairings (56+)
Google Fonts integration with matching heading/body combinations

### UX Guidelines (98+)
Best practices and anti-patterns for common UI patterns

---

## Stack-Specific Guidelines

Supported stacks:
- `html-tailwind` (DEFAULT)
- `react` / `nextjs`
- `vue` / `svelte`
- `react-native` / `flutter`
- `swiftui` / `jetpack-compose`
- `shadcn`

---

## Design Workflow

1. **Analyze Requirements** - Extract product type, style keywords, industry, technology stack
2. **Generate Design System** - Pattern, style, colors, typography, effects
3. **Apply UX Guidelines** - Follow priority rules above
4. **Validate Checklist** - Run through pre-delivery checklist before completion

---

*Source: [UI UX Pro Max Skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)*
