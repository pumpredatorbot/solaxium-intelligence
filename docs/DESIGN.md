# Design system

The console is an AI mission-control surface: near-black, high density, technical typography,
restrained accent light. Every visual element should carry information; decoration that carries
none is removed.

---

## Two colour systems, deliberately separate

This is the rule that matters most, and it is easy to get wrong.

### 1. Interface chrome — the neons

```
cy   #22E0F0   cyan      primary accent: focus, live state, the Core
az   #4C8DFF   azure     secondary: lineage edges, learning states
vi   #9A6BFF   violet    execution states, nucleus halo
mg   #F05BD0   magenta   adaptation: clone pulses, analysis states
```

These are for borders, glows, the brand, status dots and the Core visualisation. They are bright
and saturated because they are *light*, not data.

### 2. Data marks — the validated steps

```
--viz-1     #17A3B8   series 1 / single-series default
--viz-2     #C08428   series 2
--viz-good  #1E9E74   status: good
--viz-warn  #C08428   status: warning
--viz-bad   #CC4257   status: critical
```

**A chart may only use these.** The neons sit outside the readable lightness band and fail
colour-vision separation, so they cannot encode identity.

### Why these values

The palette was not chosen by eye. It was run through the data-visualisation validator against
the panel surface `#0A0E1A`:

| Palette | Result |
|---|---|
| `#22E0F0, #4C8DFF, #A06BFF, #F05BD0` (the obvious neon set) | **FAIL** — azure↔violet ΔE 0.2 deutan, 12.4 normal |
| `#17A3B8, #D14FA8, #C08428` | **FAIL** — cyan↔magenta ΔE 2.9 deutan |
| `#17A3B8, #C08428` | **PASS** — ΔE 18.1 protan, 22.1 normal |
| `#1E9E74, #C08428, #CC4257` (status) | **PASS** — worst adjacent ΔE 8.4 protan |

An all-cool neon palette is beautiful and near-useless for categorical encoding: the hues are too
close together. So violet and magenta were dropped from the chart palette entirely and kept for
chrome, and the readable band (L 0.48–0.67) fixed the steps.

To re-check after any change:

```bash
node scripts/validate_palette.js "#17A3B8,#C08428" --mode dark --surface "#0A0E1A"
```

---

## Chart rules

- **One measure, one y-axis.** Never a dual-axis chart. Capital in SOL and a population count do
  not share a scale — the Performance panel tabs between them instead.
- **Ordinal data gets a sequential ramp, not categories.** Generation is ordinal, so
  `ColumnChart` uses one hue with a narrow opacity ramp. Height is the measure; the ramp only
  orders the cohorts, and stays subtle so it cannot be read as a second variable.
- **Ranked bars use a single hue.** Identity comes from the row label, so a colour per category
  would encode nothing new.
- **Many series become small multiples.** Eight traits are eight sparklines, each a single series,
  rather than an eight-colour spaghetti chart no palette could separate.
- **Status colours ship with a label.** `StatusBar` always renders its legend.
- **Text wears ink tokens, never the series colour.**
- **Line and area charts carry a crosshair and tooltip** by default.
- **Formatting crosses the boundary as data, not a function.** Charts are client components
  rendered from server components, so they take a `NumberFormat` object (`{ decimals, signed,
  prefix, suffix }`). A callback prop cannot be serialised across that boundary.

---

## Surfaces and type

```
void      #04050B   page
abyss     #070A12   sidebar, topbar
surface   #0A0E1A   panels
raised    #0E1422   rows, inputs
line      #171E2F   hairlines
```

Backgrounds are blue-black rather than neutral black — it reads as instrumentation rather than as
an absence of light.

Type is Inter for prose and JetBrains Mono for everything numeric or labelled. All figures use
`font-variant-numeric: tabular-nums` (`.tabular`) so digits never change width as they update —
a number that jitters while it counts is unreadable.

Labels are `3xs` (10px) uppercase with wide tracking. Density is the point: a mission-control
surface should show a lot at once without clutter.

---

## Motion

Animation is used only where it carries meaning:

| Motion | Meaning |
|---|---|
| Breathing dot | The run is live |
| Node scale-in | An agent was born |
| Node fade to red | An agent died |
| Pulse along a lineage edge | A clone was produced from that parent |
| Expanding ring | That agent acted this cycle |
| Row slide-in | A new event arrived |

There is no ambient motion for its own sake. `prefers-reduced-motion` disables decorative
animation globally in `globals.css`, and the Core drops its wobble and nucleus pulse.

---

## The Core visualisation

Canvas 2D, not SVG or DOM: a few hundred animated nodes as DOM elements would thrash layout every
frame.

- **Nodes** are real agents. Radius tracks capital, colour tracks state.
- **Rings** are generations — generation 0 nearest the nucleus.
- **Edges** are real parent→child lineage.
- **Angles** are a hash of the agent id, so a node never jumps between polls.
- **Module badges** are HTML, not canvas, so the labels stay legible and available to a screen
  reader. Each lights from the real telemetry kinds mapped in `MODULE_BY_KIND`.

Performance: the loop skips entirely when the tab is hidden, pulses are capped at 140, the device
pixel ratio is clamped to 2, and the canvas is resized through a `ResizeObserver` rather than on
every frame.

---

## Data honesty

The console must never show a number the engine did not produce.

- KPI values are live engine totals. Their **sparklines and change indicators come from this
  client's own observation buffer** and are session-scoped — the tooltip says so.
- Telemetry lines are expansions of recorded `AGENT_ACTION` fields. If a field is absent, the line
  is not emitted. Asserted in `tests/telemetry.test.ts`.
- At high playback speeds the engine outruns the telemetry cursor, so the feed shows a trailing
  window and labels itself **Trailing**. Lifecycle events are polled on a separate filtered cursor
  and stay complete at any speed.
- Charts are reconstructed from the ledger, so they cannot disagree with the balances.

---

## Responsive

Desktop is the target; the layout degrades deliberately.

- Below `lg` the sidebar becomes an overlay behind a hamburger.
- Below `xl` the three-column console stacks, with the Core first.
- Grids are pinned to `grid-cols-1` below their breakpoint and children carry `min-w-0`. Without
  this an auto-sized grid column takes the max-content width of its widest row and pushes the
  whole page sideways — which is exactly what happened before it was fixed.
- Wide tables scroll inside `overflow-x-auto`; the page body never scrolls horizontally.
