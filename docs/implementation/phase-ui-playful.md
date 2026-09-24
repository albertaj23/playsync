# UI Phase: "Friendly listening room" (making PlaySync playful and easy)

Plan for Claude Code. Read `CLAUDE.md` first (especially §5 "Frontend: two audiences" and deviation 27 about the dark redesign). This plan changes look, copy and motion only. **No API, schema or strategy changes.**

## 0. Goal

The app currently reads as a formal, technical dashboard: a near-black zinc/violet theme, neutral copy ("Holds up under pressure"), static cards, emoji as the only illustration, and identical chrome on friendly and nerd pages. The goal is that a first-time, non-technical visitor smiles, understands what to click, and gets clear, encouraging feedback for every action, while **Stats for nerds stays precise and technical**.

Success looks like:
- A new user can run the "handoff" demo on `/devices` with no explanation.
- Every action has visible, delightful feedback (something moves, something confirms).
- Errors and rejections read like a friendly person talking, never like a system.
- Nothing is slower, less accessible or less reliable than today.

## 1. What the two sources give us (researched 2026-09-24)

### Watermelon UI (https://ui.watermelon.sh)
- Open-source React catalog: 516 components, **131 animated components**, 189 blocks, 12 dashboards, 1 template, 2 showcases.
- Components are distributed as a **shadcn registry**: `npx shadcn@latest add https://registry.watermelon.sh/r/<slug>.json`. Each entry is a JSON file whose `files[0].content` is the source (`components/watermelon/<slug>.tsx`). Public read-only catalog API: `/api/catalog/summary`, `/api/catalog/entries?kind=animated-components` (needs a browser-like user agent; curl works, Python's default is blocked).
- Verified on 6 components (copy-confirm, feature-tour, fluid-tabs, gooey-menu, command-search, dialog-stack): **self-contained**. They use plain Tailwind colors with `dark:` variants, have no `@/` imports and no shadcn theme tokens.
- **Dependencies are the catch.** They use `motion` (or `framer-motion`) and `lucide-react`; some also pull `@hugeicons/*`, `react-icons`, `next-themes` (Next.js specific, do not use).
- The site also offers an MCP server (`https://mcp.watermelon.sh/mcp`: `search`, `get_inspiration`, `get_component`, `compose_page`) for finding components while building.

Most relevant animated components for us: **Copy Confirm** (copy button with confirm morph), **Feedback** (morphing icons for thumbs/reactions), **Feature Tour** (guided tour with blur/shine), **Fluid Tabs / Discrete Tabs / Continuous Tabs** (animated tab bars), **Dock Component** (mobile bottom navigation), **Command Search** (Cmd+K palette), **Dialog Stack** (layered modals, good for the "Play here instead?" prompt), **Card Swipe**, **Gooey Menu**, **Expandable Event Card**, **Floating Input**, **Emoji Spree Choice Chips** (fun choice chips), **Adaptive Slider**, **Expand Details / Disclosure** family, **Alert 1-30** (toasts/banners).

### Anime.js (https://animejs.com/documentation), installed as v4.5.0
The summarised docs page describes the old v3 API (`anime({targets})`). **The project has v4**, which differs: `animate(targets, params)`, named ESM imports. Verified exports in the installed package: `animate, createTimeline, createScope, stagger, onScroll, createSpring/spring, createDraggable, createDrawable, morphTo, createMotionPath, splitText, scrambleText, createAnimatable, createLayout, utils, waapi, eases`. Always check `node_modules/animejs/dist` types rather than blog snippets. (This bit us once already: two `DeviceCard` calls used the v3 form and broke the build.)

Best fits: page entrances and staggered lists (`animate` + `stagger`), sequenced hero/celebration choreography (`createTimeline`), text reveals (`splitText`), SVG line drawing for the wait-for graph and equalizer (`createDrawable`), scroll reveals (`onScroll`), springy drag/toss (`createDraggable`, `createSpring`), number count-ups (`animate` on an object + `onUpdate`), automatic layout transitions (`createLayout`).

## 2. Decisions this plan makes (change any before starting)

| # | Decision | Why |
|---|---|---|
| D1 | **Role split.** anime.js owns *choreography* (page/section entrances, stagger, timelines, counters, SVG, celebrations). `motion` (Watermelon's dependency) owns *component-internal interaction* (AnimatePresence enter/exit, layout/shared-element, hover/tap springs) inside the copied Watermelon components only. | Avoids rewriting components we copy, and avoids fighting over the same element. Rule: **one library per element**, never both animating the same node. |
| D2 | **Copy component source, don't run the shadcn CLI.** Fetch `registry.watermelon.sh/r/<slug>.json`, write to `web/src/components/watermelon/`, adapt. | Components are self-contained; the CLI would add `components.json`, an `@/` alias and `utils` we don't otherwise need. Keep a `web/src/components/watermelon/README.md` listing each source URL and any edits. |
| D3 | **Icons: `lucide-react` only.** Replace any `@hugeicons/*` / `react-icons` imports while copying. Never add `next-themes`. | One small icon set; less bundle. |
| D4 | **Theme: keep dark as default but make it warm, plus a light "daylight" theme with a toggle**, instead of the cold zinc/violet. | Formal feel comes largely from the cold near-black palette. Offering light/dark also matches Watermelon's `dark:` variants. |
| D5 | **Personality without mascots first**: friendly voice, rounded chunky shapes, big type, device "characters" (avatars with names and moods). A mascot is an optional later add-on. | Cheap, cohesive; a mascot is easy to get wrong. |
| D6 | **Code-split routes** (React.lazy) and keep the initial bundle at or below today's (~685 kB / 198 kB gzip). | `motion` (~50-90 kB) would otherwise push the initial load up. |
| D7 | **Sound: off.** No audio effects. | Out of scope; annoying in demos. |

## 3. Diagnosis: why it feels formal, and the fix for each

| Symptom now | Fix |
|---|---|
| Cold near-black + violet + thin gray text | Warm palette + light/dark themes (see §4.1), bigger text, stronger contrast for body copy |
| Small tight buttons/cards, 1px hairline borders | Rounder shapes (2xl/3xl), chunkier buttons, soft shadows, tinted surfaces |
| Copy like "Holds up under pressure", "Protected: 1 device played, within the limit of 1" | A voice guide (§4.2) with a rewrite table for every friendly page |
| Static cards, entrance fade only | Purposeful motion: hover lift, press squish, staggered lists, celebration when something works (§4.3) |
| Emoji as the only art | Device avatars with personality, small inline SVG illustrations for empty states, animated equalizer/vinyl |
| Same visual language on friendly and nerd pages | Friendly pages get the playful skin; nerd pages stay dense and monospace (deliberately calmer) |
| No guidance | Feature Tour on first visit, inline hints, friendly empty states, a Cmd+K palette (`Command Search`) |
| No reduced-motion support anywhere | Global motion policy (§4.4) |

## 4. Design system

### 4.1 Theme tokens (`web/src/index.css`)
- Define semantic CSS variables (`--surface`, `--surface-raised`, `--ink`, `--ink-soft`, `--accent`, `--good`, `--warn`, `--bad`, `--info`, `--radius`) for **dark** (warm ink: deep plum/charcoal, not blue-black) and **light** ("daylight": cream background, white cards).
- Add the Tailwind v4 variant so Watermelon's `dark:` classes work with our toggle: `@custom-variant dark (&:where(.dark, .dark *));` and put `class="dark"` (or none) on `<html>` from a small `useTheme` hook that persists to `localStorage` (wrapped in try/catch) and follows `prefers-color-scheme` on first visit.
- Playful accent set: **watermelon coral** `#ff5c7a`, **mint** `#34d399`, **sunny** `#fbbf24`, **sky** `#38bdf8`, **grape** `#8b5cf6`. Semantic mapping: playing/success = mint, moved/info = sky, rejected/warn = sunny, over-limit/error = coral. Keep AA contrast for text (check with a contrast script, see §7).
- Keep the existing remap of the old `stone` scale until the nerd pages are migrated (deviation 27); once they use semantic tokens, delete it.
- Fonts: keep Inter for UI and JetBrains Mono for nerds; add a rounded display face for headings only (e.g. **Fredoka** or **Nunito**, via the existing Google Fonts link), used on friendly pages only.

### 4.2 Voice guide (put in `docs/ui-voice.md`)
Rules: second person, short sentences, verbs first, no jargon on friendly pages (existing rule), celebrate small wins, be kind in failures, never blame the user, use one emoji at most per message and only where it adds meaning.

Rewrite table (apply on Home, Devices, Device, Stress, DeviceCard messages):

| Now | Friendly |
|---|---|
| "Playback moved to iPhone." | "Your music hopped over to the iPhone 🎧" |
| "Stream limit reached (policy REJECT)." | "Someone in your household is already listening, so this one is waiting its turn." |
| "Playback stopped. This device stopped checking in…" | "We lost touch with this device, so we let its spot go. Tap Play to grab it back." |
| "Protected: 1 device played, within the limit of 1." | "Nice! Only 1 screen got in, exactly as allowed 🎉" |
| "Broken: 30 devices are playing, but the limit was 1." | "Whoa, 30 screens all got in and only 1 was allowed. That's the bug we're hunting 🐛" |
| "Loading…" | "Warming up the speakers…" |
| Empty nerd-facing states on friendly pages | A small illustration + one actionable sentence |

### 4.3 Motion language (anime.js unless noted)
Define named presets in `web/src/lib/motion.ts` so pages don't hand-tune numbers:

| Preset | Use | Sketch |
|---|---|---|
| `enterUp(targets)` | page sections, cards | opacity 0→1, translateY 24→0, 450 ms, `outCubic`, `stagger(70)` |
| `pop(target)` | buttons on success, badges | scale 0.9→1.06→1 with `createSpring` |
| `press(target)` | button press | scale to 0.96 on pointerdown, spring back (CSS `:active` first, anime only if needed) |
| `countUp(el, to)` | Violations counter, KPIs, "N screens" | animate a plain object, write rounded value in `onUpdate` |
| `celebrate(root)` | verdict "protected" / handoff success | a `createTimeline` of 12-20 tiny coral/mint/sunny particles bursting from the verdict icon, 900 ms, removed on complete |
| `shake(target)` | rejection | translateX keyframes ±6 px, 300 ms |
| `pulse(target)` | waiting/connecting | loop scale 1→1.04, only while state is active; stop on unmount |
| `drawPath(svg)` | wait-for graph arrows, equalizer | `createDrawable` stroke reveal |
| `heroText(el)` | Home headline | `splitText` words, stagger 60 ms |
| `scrollReveal(targets)` | long pages | `onScroll` with `once` |

`motion` (Watermelon) is used only inside copied components (tabs, dock, dialog stack, command search, feature tour, feedback, copy confirm).

### 4.4 Motion policy and safety (non-negotiable)
1. **`prefers-reduced-motion: reduce`**: `motion.ts` exports `reduced()`; every preset returns instantly (final state, no movement, no particles). Watermelon components get `MotionConfig reducedMotion="user"` at the app root.
2. **Never leave content hidden.** Do not set inline `opacity: 0` in JSX. Start hidden with a CSS class that is removed by the animation's `onComplete` *and* by a 2.5 s fallback timer (a paused background tab or a failed animation must not hide UI). This exact bug happened on `/devices` (fixed by lazy scope creation in `useAnime`); keep that fix and add a test.
3. Animate only `transform` and `opacity` (plus color where cheap). No layout-thrashing properties in loops.
4. Every looping animation stops on unmount and when `document.hidden`.
5. Keep total entrance choreography under 900 ms; nothing blocks interaction.
6. No animation on the nerd pages except the wait-for graph arrows and lock-table row highlights (functional feedback).

## 5. Page-by-page plan

Shared: each visual component stays **under ~200 lines**, split into files under `web/src/components/<area>/` (a long single-file component previously tripped the tool safety classifier; if a write is blocked, split it or hand it to Copilot with a task file).

### 5.1 Global shell (`App.tsx`, header)
- Rounded pill navigation with a sliding active indicator (**Fluid Tabs**) on desktop; on phones a floating bottom **Dock** (Watermelon Dock) with 4 icons (Home, Devices, Stress, Nerds) so thumbs reach it.
- Theme toggle (sun/moon) with a small morph; **Cmd/Ctrl+K palette** (Command Search) listing pages, presets ("Open Family fight"), and actions ("Stop everything").
- A friendly logo mark with a tiny idle animation (equalizer bars).
- Page transitions: crossfade + `enterUp` on route change (reduced-motion safe).

### 5.2 Home
- Headline reveal with `splitText`; the four device emoji become small **device avatars** that bob out of phase.
- "How it works" 3 steps become an illustrated horizontal story that reveals on scroll (`onScroll`), each step with a tiny looping SVG (device lights up, second device asks, a shield holds).
- Destinations become big tactile cards (hover lift + tilt, press squish).
- A **"Try it in 10 seconds"** primary button that launches a scripted mini-demo on `/devices` (uses the existing real API; Feature Tour explains each step).
- Footer status becomes a friendly chip ("Speakers are warm ✅ / Can't reach the database. Is Docker running?").

### 5.3 My devices + single device (`DevicesPage`, `DevicePage`, `DeviceCard`)
- **Device avatars**: each device gets a character (rounded body, eyes that look toward the playing device, mood: idle 😌, playing 🎶 bopping, waiting 😬, moved 😮, offline 😴 with floating "z", stopped 🥺). Implemented as inline SVG + anime.js timelines; no images.
- Play button gets a springy press, a ripple, and a **celebration** only on the first successful handoff per session (not every press).
- "Play here instead?" prompt becomes a **Dialog Stack** style sheet (bottom sheet on phones) with two big buttons.
- Messages use the voice guide and slide in with `enterUp`; dismissed with a swipe/close.
- Settings card: **Emoji Spree Choice Chips** style chips for "when a new device starts playing", a big friendly stepper for "screens allowed" with a count-up.
- Empty/idle state: "Nothing is playing. Pick a song and tap Play 🎵".
- Real-time moments: the moved device does a soft `shake`+fade, the new device `pop`s; the household banner ("Playing on iPhone") crossfades.

### 5.4 Stress test
- Rename tabs to friendlier labels ("Everyone taps Play" / "Counting plays").
- The dot grid becomes **animated dots** that pop in with stagger, sorted so the wrongly admitted ones turn coral and wobble; count-up on the verdict numbers.
- Verdict cards: mint card + `celebrate` for protected, coral card + gentle `shake` for broken, each with a one-line "why" in friendly words and a "See the nerdy version →" link.
- "Compare all" becomes a race track: six lanes fill left-to-right as results arrive (progress feels alive instead of a spinner).
- Presets as chips ("Chaos mode", "Fair play") with a tooltip story (this also prepares `/sim` from `phase-sim.md`, which should reuse `motion.ts`, the avatars and the verdict card).

### 5.5 Stats for nerds (light touch only)
Keep dense and monospace. Changes: migrate leftover `stone-*` and light-mode tints to the semantic tokens, add the theme toggle support, animated tab underline (Fluid Tabs), lock-table row highlight when a lock is granted/waiting, wait-for graph arrows draw in (`drawPath`) and pulse coral on a cycle, count-up on Stat tiles. Nothing playful in copy. Add a small "← Back to the friendly version" link.

### 5.6 Onboarding and help
- **Feature Tour** on first visit to `/devices` (skippable, remembers via `localStorage` in try/catch): 4 steps ("Tap Play here", "Now try another device", "See the handoff", "Open the nerdy view").
- Inline `?` hover cards using Watermelon disclosure/popover style for terms ("lease", "limit") on friendly pages, in plain language.
- **Copy Confirm** on the phone URL for the real-phone demo and on batch links.

### 5.7 Toasts and errors
Replace ad-hoc `<p className="text-rose-…">` errors with one `Toast` (built from Watermelon Alert styles) rendered by a tiny `ToastProvider`. Toast copy comes from the voice guide; 409 BUSY becomes "Another experiment is running. Try again in a moment ⏳".

## 6. Implementation steps (stop and report after each; commit only on request)

| # | Scope | Done when |
|---|---|---|
| U0 | **Preflight.** Confirm anime.js v4 usage compiles; add `lib/motion.ts` with `reduced()`; add the global `MotionConfig`; write `docs/ui-voice.md`; fix any remaining inline `opacity:0`. Add a test that `useAnime` creates its scope when the ref attaches late. | typecheck/build clean, reduced-motion toggle verified |
| U1 | **Tokens + themes.** Semantic variables, light/dark, `@custom-variant dark`, `useTheme`, toggle, fonts. Migrate `ui.tsx` primitives (Card, Button, Badge, Field, Segmented, Stat, Dot) to tokens. Delete nothing yet. | every page renders correctly in both themes, AA contrast script passes |
| U2 | **Dependencies + Watermelon vendoring.** `npm i motion lucide-react`. Add `scripts/vendor-watermelon.mjs` (fetch registry JSON, write file, rewrite icon imports to lucide, report deps). Vendor: Fluid Tabs, Dock, Command Search, Dialog Stack, Feature Tour, Copy Confirm, Feedback, one Alert. Record sources in `components/watermelon/README.md`. Route-level `React.lazy`. | bundle size at or below today's initial size, all vendored components render in a scratch route `/ui-lab` (dev only) |
| U3 | **Shell.** Pill nav, mobile Dock, theme toggle, Cmd+K, route transitions. | keyboard and touch both work, 375 px verified |
| U4 | **Device avatars + DeviceCard/Devices/Device** (§5.3), voice rewrite of `deviceMessages.ts`. | handoff, offline and takeover flows still pass the existing browser checklist, avatars react to real state |
| U5 | **Home + Stress** (§5.2, §5.4), celebrations, count-ups, race track. | verdict numbers match the server, no hidden content in a hidden/background tab |
| U6 | **Nerds polish + toasts + onboarding** (§5.5-5.7). | all 8 nerd tabs still functional, stepper scenarios still pass |
| U7 | **QA + docs.** Update README screenshots/demo script, `CLAUDE.md` (new deviations, repo map, theme rules), remove the `stone` remap if unused. | full checklist in §7 passes |

Each step lists the exact files it touches in its report. Sequence matters: U1 before anything visual, U2 before U3-U6.

## 7. Verification (every step)

Automated:
- `npm run typecheck`, `npm -w web run build`, `npm test` (server 140 + web tests) stay green.
- New web unit tests: `motion.reduced()` short-circuits presets; `useAnime` late-ref scope; `useTheme` persistence with storage disabled (throws); voice-guide message mapping (`deviceMessages`); count-up ends at the exact target.
- A contrast script (small Node script using computed token colors) asserts AA (4.5:1) for body text and 3:1 for large text in both themes.
- Bundle guard: fail if the initial JS chunk grows past the recorded baseline (record it in `docs/ui-baseline.json`).

Browser (desktop 1280 and 375 px, both themes):
- Every route and every nerds tab loads, no horizontal scroll, no console errors (expected 409/410 logs are fine).
- **Reduced motion**: emulate `prefers-reduced-motion: reduce`; nothing moves, everything visible.
- **Hidden tab**: load `/devices` while the pane is hidden; cards must still appear (fallback timers).
- Run the demo script (handoff, zombie, lease expiry, write skew, lost update) end to end; the Stepper and Lab pages must behave exactly as before.
- Keyboard: tab order sensible, Cmd/Ctrl+K opens the palette, Esc closes dialogs/tour, focus rings visible.
- Performance: first interaction under 100 ms on `/devices`; long animations pause when `document.hidden`.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Two animation libraries fight over one element | D1 rule: one library per element; Watermelon internals use `motion`, everything we author uses anime.js; code review checklist item |
| Bundle growth from `motion` and `lucide-react` | Import icons by name only, lazy routes, bundle guard test |
| Copied third-party code drifts or has licence terms | Record source URL + date per file; check the repo licence at `github.com/WatermelonCorp/watermelon-platform` and `watermellon-registry` before vendoring more than a handful; keep edits minimal |
| Playfulness leaking into nerd pages or technical terms into friendly pages | Two-audience rule stays; add a lint-style test that greps friendly pages for banned words (`lease`, `session #`, `HTTP`, `409`, strategy identifiers) |
| Light theme breaking the recharts colors and SVG fills | Chart colors come from CSS variables read at render; verify each chart in both themes |
| Tool classifier blocking large component writes | Keep components small; split files; fall back to a Copilot task file (as done before) |
| anime.js v4 vs. v3 snippets on the web | Only use APIs present in the installed package's types; add a `docs/ui-motion-cheatsheet.md` with verified v4 examples |
| Another contributor is editing the same web files | Do U0 first and agree on ownership of `ui.tsx`, `index.css`, `App.tsx`; work on a `phase-ui` branch cut from the current branch |

## 9. Open questions for the owner (answers change the plan)

1. **Theme**: dark-only warm redesign, or light + dark with a toggle (recommended, D4)?
2. **Mascot**: device characters only (recommended), or also a named mascot (a watermelon slice)?
3. **Scope**: friendly pages only, or also a light refresh of the nerd pages (recommended: light touch, §5.5)?
4. **Branding**: keep the name "PlaySync" and the ♪ mark, or restyle the logo?
5. **Display font**: Fredoka (bubbly), Nunito (soft, safer), or keep Inter only?
6. **Ordering vs. `/sim`**: build this UI phase first (so `/sim` inherits avatars, verdict cards and motion presets, recommended) or after M1 of the simulator?
7. **Licence check**: OK to vendor the listed Watermelon components (open source, but I have not yet verified the licence text)?
