# Design System: HearthShelf (shared contract)

<!-- This file is the cross-surface design contract. It lives in HearthShelf-Core
     because the palette it describes is not a convention - it is enforced by
     account-scoped settings in src/lib/settings.ts that sync across every
     surface. Web and mobile each keep their own DESIGN.md for the platform
     layer; both inherit everything below. -->

**Surfaces:** `HearthShelf-WebApp` (hosted front door), `HearthShelf` (self-hosted
SPA), `HearthShelf-Mobile` (iOS + Android + car). One identity, three mediums.

## Why this file exists

Theme, accent color, and glow strength are **account-scoped settings defined in
`src/lib/settings.ts`** and synced across surfaces. A user who picks an accent on
the phone sees it on the web. That makes the palette a *contract with two
renderers*, not two design systems that happen to resemble each other. Drift
between surfaces in anything below is a bug, not a dialect.

Everything in this file is binding on every surface. Everything **not** in this
file is the platform's own call — see "What stays platform-local" at the end.

## Creative North Star

Both surfaces describe the same room from a different distance, and both names
are correct in their own document:

- Web: **"The Fireside Listening Room"**
- Mobile: **"The Hearthside Shelf"**

The shared image: **a warm room at night with one fire in it, furnished for
listening.** The fire is the only live light. Cover art is the content. The
chrome is quiet enough that artwork is the most saturated thing on screen.

The metaphor stays a metaphor on every surface. No wood grain, leather, paper
textures, or bookshelf illustrations, ever.

## Colors

These values are identical across surfaces today and must stay identical. The
listed hexes are the **dark theme** resolution; each surface resolves light and
flat/OLED from the same token names.

### Ground and surfaces

| Token | Value | Role |
|---|---|---|
| `ink` / `scaffold` | `#1b1a18` | The room. Every screen's ground. |
| `surface-lowest` | `#131211` | Recessed wells; content that sits *in*, not *on*. |
| `surface-low` | `#201e1c` | First step up. |
| `surface` / `base` | `#242220` | Default raised surface. |
| `surface-high` | `#2a2825` | Cards and rows. |
| `surface-highest` | `#322f2b` | Above cards; empty cover wells. |
| `sheet` | `#222120` | Sheets and modals — deliberately distinct from `surface`. |

### Type colors

| Token | Value | Role |
|---|---|---|
| `paper` / `text` | `#f4f1ea` | Primary text. Warm off-white, never pure white. |
| `text-muted` | `#aba498` | Secondary copy, metadata. |
| `text-faint` | `#756f64` | Tertiary hints, grab handles. The legibility floor. |
| `border` | `#383530` | Solid edges that must survive against artwork. |

### Brand and state

| Token | Value | Role |
|---|---|---|
| `ember-coral` | `#e0654a` | The functional accent. **User-changeable** — this is the default. |
| `hearth-gold` | `#bd863f` | Brand only. The "Hearth" half of the wordmark. |
| `shelf-cream` | `#f0e6d6` | Brand only. The "Shelf" half of the wordmark. |
| `destructive` | `#c4463a` | Destructive actions. **Deliberately not the ember.** |
| `affirm-green` | `#5a9c52` | Success and completion. |

### Neutral fills

Fills are **6% white** (`rgba(255,255,255,0.06)`), strong fills **10%**, and
hairlines **8%** (`rgba(255,255,255,0.08)`). Alpha, not solid, so they inherit
the warmth of whatever they sit on.

### Named Rules

**The Warm Grey Rule.** Every neutral carries brown: R ≥ G ≥ B by a hair. The
ground is `#1b1a18` and not `#18181b` on purpose. A cool grey anywhere in the
stack makes the whole room read as a different, colder app — never navy, never
muddy.

**The Two Warms Rule.** Ember Coral is functional; Hearth Gold is brand. A
control tinted gold is a bug, and a wordmark tinted coral is a bug. They are
close in hue on purpose — that is what makes the discipline necessary.

**The Cover-Supplies-Colour Rule.** Saturated color on a library screen comes
from artwork, not from UI. If a new component needs color to be understood,
prefer the glow, a surface step, or type weight before reaching for a hue.

**The Destructive-Is-Not-Ember Rule.** Destructive actions use `#c4463a`, never
the accent. A delete button that shares a hue with the progress bar is a hazard,
and the accent is user-changeable — a user could set it to anything, including
green.

**The Live Accent Rule.** Accent-tinted surfaces are always derived from the
*live* accent by alpha or `color-mix`, never a second hardcoded hex. That is what
lets a user's chosen accent flow everywhere instead of stranding the default
ember in half the app.

## Typography

Three voices, same roles on every surface.

| Voice | Family | Role |
|---|---|---|
| Functional | **Inter** | Every button, label, row, and body string. Does the work, never performs. |
| Editorial | **Libre Baskerville** | Wordmark, tracked uppercase eyebrows, pull-quotes, book prose. |
| Measurement | **Geist Mono** | Any number that changes in place — elapsed, remaining, position. |

**Scale is platform-local.** Web's display tier is ~76px; mobile's largest type
is 22px. That is a viewing-distance difference, not drift, and neither surface
should adopt the other's scale.

### Named Rules

**The Rare Serif Rule.** Libre Baskerville appears in the wordmark, eyebrows,
pull-quotes, and book prose. It never sets a heading, a button, or a label. Its
scarcity is the point.

**The Tracked Kicker Rule.** The eyebrow is uppercase, wide-tracked, and light.
It is the one place this system is overtly stylish. Keep it wide, keep it light.

**The Mono Numerals Rule.** Proportional numerals jitter the layout on every
tick. Anything counting in place is Geist Mono.

## Shapes

One radius ladder, shared:

| Token | Value | Applies to |
|---|---|---|
| `cover` | `10px` | Cover art and small tiles. |
| `row` | `12px` | List rows, inline controls. |
| `card` | `16px` | Cards, primary buttons. |
| `sheet` | `24px` (web) / `20px` (mobile) | Sheets and modals. |
| `pill` | `999px` | Chips, badges, segmented controls. |

Radius tracks size and permanence: the bigger and more container-like the
element, the larger the radius.

**The No-Sharp-Corners Rule.** Nothing in this system has a 0px radius. Softness
is part of the room.

## The cover glow

**This is the single strongest shared signature and both surfaces already
implement it independently.** A soft bloom of the current book's hue, falling
from the top of the surface behind the content, tinted live by the artwork.

Both surfaces derive that hue **deterministically from a seed string** rather
than sampling pixels — same hash (`h * 31 + charCode`), so a shared palette
produces identical color for the same book everywhere.

- Shared implementation: `coverHue(seed)` in `src/lib/format.ts`.
- Strength is the account-scoped `glow` setting (0–60, default 60).
- Flat/OLED sets glow strength to **0** and removes the atmosphere entirely.

### Named Rules

**The One Light Source Rule.** One bloom per screen, sourced from the artwork. A
second glow competing on the same screen breaks the room. (Multiple screens each
having their own single glow is correct; two on one screen is not.)

**The Flat-Theme Rule.** Flat/OLED is not "dark with darker colors" — it sets
glow strength to 0. Any effect that depends on the bloom must still read with it
switched off.

**The One Cover Palette Rule.** A book is the same color on every surface. Cover
hue comes from `coverHue()` in core, seeded on the **item id**, never from a
surface-local palette or a different seed.

## Themes

Four values, defined in `settings.ts` as account scope: `auto`, `dark`, `light`,
`flat`, `oled`. **Dark is home; light is a daytime option, not the default.**
Flat/OLED is a true-black variant with the atmosphere removed.

Every surface must render correctly in all of them. A surface that only looks
right in one palette is unfinished.

## Accent

`accentHex` (default `#e0654a`) and `accentMode` (`manual` | `dynamic`) are
account-scoped and synced. `dynamic` means the accent follows the current book's
cover hue; `manual` pins it to the user's chosen hex.

Because the accent is user-changeable, **nothing may assume it is warm, or even
that it is coral.** Foreground text over the accent is chosen by relative
luminance, not hardcoded.

## What stays platform-local

Each surface's own `DESIGN.md` owns these, and neither should inherit the
other's:

| Concern | Web | Mobile |
|---|---|---|
| Type scale | Display up to ~76px | 22px ceiling, 11px floor |
| Interaction | Hover states, right-click menus, keyboard shortcuts | Long-press sheets, swipes, gestures, haptics |
| Feedback | Hover lift, focus rings | Press-scale, Android ripple, haptics |
| Motion | CSS transitions, 150–180ms | Reanimated springs, Shelf Lift, Reduce Motion gating |
| Navigation | Sidebar / content column | Glass tab bar, pushed stack |
| Density | Admin panels may be dense | Thumb-zone reachability governs |
| Charts | Chart palette (tide / moss / dusk / brass) | Borrow web's chart palette if charting |
| Constraints | Viewport breakpoints | Safe-area insets, 1.25× font-scale ceiling, car glanceability |

Platform divergence is correct where the **medium** differs. It is drift where
the **identity** differs. If a change would make the same book, the same state,
or the same brand mark look different on two surfaces, it belongs here — not in a
platform file.
