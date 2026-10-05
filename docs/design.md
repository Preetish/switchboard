# Design standard

How every Switchboard surface should look, behave, and be built. The tokens in
`packages/ui/src/tokens.css` are the implementation; this document is the law.

## Principles

1. **Speed is the product.** Every surface must *feel* instant: skeleton states
   before spinners, optimistic UI where safe, no layout shift, no blocking
   fonts. A lead's booking page must render interactive in under a second.
2. **Calm and content-first.** The UI is a stage for the lead's booking decision
   and the rep's routing log. No gradients-for-the-sake-of-gradients, no
   decorative animation, no marketing noise inside product surfaces.
3. **Accessible by default.** WCAG 2.2 AA. Keyboard-first flows. Visible focus
   rings. Never encode meaning in color alone. Respect `prefers-reduced-motion`.
4. **Honest states.** Loading, empty, error, and success states are designed,
   not afterthoughts. Errors say what happened and what to do next.

## Tokens

- All color, spacing, radii, shadow, type, and motion values come from `--sb-*`
  custom properties in `packages/ui/src/tokens.css`. **No raw hex, no magic
  px/rem values in components** — if a value is missing, add a token first.
- Color is defined in oklch: perceptually uniform ramps (`--sb-gray-50..950`)
  plus one accent (`--sb-accent`, signal orange) and semantic colors.
- Dark mode is a token override via `prefers-color-scheme`, never a rewrite.

## Layout and rhythm

- **8px spacing grid**: compose from `--sb-space-*`. Nothing sits outside it.
- **Radii**: sm for chips/inputs, md for buttons, lg for cards, full for pills.
- **Elevation is scarce**: exactly one shadow token, used only for floating
  overlays. Surfaces are separated with `--sb-border`, not shadows.
- **Type**: system font stack (`--sb-font-sans`), scale from `--sb-text-*`,
  tight tracking (−2%) on headings, 1.6 line-height on body.

## Components

- Buttons: single primary style (accent), quiet secondary (surface + border),
  destructive uses `--sb-danger` only for irreversible actions.
- Forms: labels above inputs, help text below, validation next to the field —
  never alert-only.
- Tables (routing log): zebra-free, muted headers, monospace for timestamps and
  latency numbers.

## Motion

- Two durations only: `--sb-duration-fast` (120ms, hovers/focus) and
  `--sb-duration-base` (200ms, enter/exit), both with `--sb-ease-out`.
- Motion communicates state change only. No parallax, no autoplay, nothing that
  survives `prefers-reduced-motion`.

## Copy

- Sentence case everywhere. Button labels are verbs ("Book meeting", not
  "Submit"). Errors are plain sentences with a next step. Numbers are real
  (latency in ms, not "fast").

## Testing the standard

Every UI change ships an end-to-end browser test of the real flow (see
`docs/decisions.md` for CI steps). Visual checks in review: does it respect the
grid, the two durations, the one shadow? Is there a keyboard path? Does dark
mode work?
