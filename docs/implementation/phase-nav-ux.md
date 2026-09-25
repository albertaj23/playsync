# Phase NAV-UX: modern navigation and sequential, immersive pages

Implementation plan for the navigation and story UI. Read together with `docs/ui-voice.md`, `docs/implementation/phase-ui-playful.md` and `docs/implementation/phase-sim.md`. Written 2026-09-24 and annotated with implementation status after the work was done.

This phase changes **only the web client**: navigation, layout, sequencing, motion and copy. It makes **no server, API, schema or strategy changes**. The one exception is the Simulation M3/M4 work, which is re-laid-out here and keeps its own server scope from `phase-sim.md`.

## Implementation status (as built)

| Milestone | Scope | Status |
|---|---|---|
| N0 | Preflight: route transform (D6), CSS layout variables (D7), Melo intro safety (D8), `lib/keys.ts` | ✅ done (the route wrapper uses fill `backwards`) |
| N1 | Shell: sidebar (expanded / rail / tablet overlay), top bar, phone tab bar + More sheet, palette at all widths, Cmd/Ctrl+B, skip link, focus-to-h1, scroll memory | ✅ done |
| N2 | Story framework (`Story`, `Chapter`, `StickyStage`, `ChapterRail`, `NextHint`, `ActionBar`, auto-advance), geo library, `useGeoScene`, Home migrated | ✅ done (`onScroll` prototype skipped by decision: deviation 29) |
| N3 | My devices as five chapters, compact cards, phone carousel, missions, gate picker | ✅ done |
| N4 | Stress test as two stories (`?exp=count`), data-true dots, auto-advance | ✅ done |
| N5 | Simulation re-layout + M3 content (feed, timeline, verdict, compare, repair, breach meter, live action bar) | ✅ done |
| N6 | Scroll-aware chrome (I5), header morph (I10), ambient layer (I7), nerds sticky tabs; I8 evaluated and ruled out; **I12 focus mode and I4 view transitions: see the final section** | ✅ done (I4/I12 behind flags) |
| N7 | QA + docs | ✅ docs; automated checks green; a full manual browser checklist was performed by the project owner |

---

## 0. Goal in one paragraph

Replace the crowded sticky top menubar with a modern app shell.

- **Desktop:** a collapsible left sidebar using the Lucide `PanelLeft*` toggle, a slim contextual top bar, and a palette reachable at every width.
- **Phones:** a labelled bottom tab bar.

Then rebuild **My devices**, **Stress test** and **Simulation** as *sequential chapters*, like the Home page. Each chapter asks the user one question, shows only what that question needs, and hands off to the next chapter. Geometric anime.js scenes accompany the story and react to scroll, and to real results where possible.

Scrolling must feel natural: no scroll-jacking (native scroll always wins); every sequenced step is also reachable by button and keyboard; reduced motion gives the same content in the same order with no movement.

### Success criteria

1. A first-time visitor on any friendly page sees **one headline question and one primary action** above the fold.
2. At no width does the top of the page carry more than: sidebar toggle, page title/breadcrumb, search, theme.
3. Stress test, Simulation and My devices each read top-to-bottom as a story, with a progress rail. Running an experiment brings you to its result automatically.
4. Each of the three pages has a geometric scene that responds to scroll, and on Stress/Sim also to real data.
5. Nothing gets worse: tests, typecheck and build stay green; initial JS within +15 kB gzip of 156 kB; reduced motion and keyboard-only both work; the existing demo scripts still run.

### Non-goals

No new experiments, strategies or server endpoints; no redesign of Stats for nerds beyond shell integration; no sound, no scroll-jacking (wheel/touch interception), no parallax that moves text.

---

## 1. Diagnosis

| # | Problem | Where | Consequence |
|---|---|---|---|
| D1 | One sticky row carries logo, 5 labelled tabs, palette, theme toggle | `App.tsx` header | Clips at ~800–1100 px; the palette was hidden below `xl` |
| D2 | Global and local nav are indistinguishable | Stress `Segmented`; Nerds 8 tabs; Sim scenario sidebar | Users can't tell "which page" from "which part of this page" |
| D3 | Everything shown at once | Devices, Stress, Sim | Information flooding, no first action, no "what next" |
| D4 | Only Home is sequential | `ScrollStory.tsx` | The app feels like two products |
| D5 | Icon-only mobile dock floats over content | `dock.tsx` | Unlabelled; `pb-24` hacks |
| D6 | Route transition left a `transform` on `.page-content` | `Page` | Every `position: fixed` descendant positioned against the wrapper |
| D7 | Hard-coded sticky offsets | `sticky top-16` | Any shell change breaks Home |
| D8 | The Home intro could hide content | `GeoMascot` `utils.set(opacity: 0)` | Violates "content visible by default" |
| D9 | No wayfinding | – | No breadcrumb, section indicator or scroll memory |

## 2. Design principles

1. **One question per chapter.** 2. **Show, then ask, then answer.** 3. **Native scroll is sacred** (scroll drives animation; animation never drives scroll except explicit actions and the one sanctioned auto-advance). 4. **Controls never live inside scrubbed regions.** 5. **Progressive disclosure has a floor** ("More", "Advanced", "Show the database"). 6. **Always know where you are** (sidebar, top-bar breadcrumb, rail, URL hash). 7. **Two audiences** (friendly pages get stories; Nerds gets the shell only). 8. **One motion system per element** (anime.js authored; `motion` only in Watermelon components; CSS transitions only where anime doesn't drive).

## 3. Information architecture

**Sidebar (desktop/tablet)** groups: *Listen* (Home, My devices), *Experiment* (Stress test, Simulation), *Under the hood* (Stats for nerds). Each item: icon, label, `aria-current`, a coral active bar; tooltips when collapsed. Footer: "Use your phone" (URL + CopyConfirm) and the DB health dot (moved from the Home footer). The collapse toggle sits in the header row next to the logo.

**Top bar (all widths, 56 px):** sidebar toggle (`Menu` on phones opens More), title (`Page › Chapter`, updating on scroll; phones show only the chapter), search trigger (opens the palette), theme toggle, plus a 2 px scroll-progress line on story pages.

**Phones (< 768 px):** labelled bottom tab bar (Home, Devices, Stress, Simulation, More); "More" is a sheet with Stats for nerds, Use your phone, theme, Search, DB status. The tab bar hides on scroll-down and reappears on scroll-up or at chapter boundaries; the chapter action bar docks into the freed space.

**Command palette** (`components/watermelon/command-search.tsx`): all widths; items gain the current page's commands ("Stop everything", "Compare all", chapter jumps) via context.

### Routes and deep links

| URL | Meaning |
|---|---|
| `/devices#meet`, `#screens`, `#missions`, `#rules`, `#more` | Chapter anchors |
| `/stress`, `/stress?exp=count` | Stress test stories; anchors `#scene #setup #guard #run #verdict #compare #deeper` |
| `/sim#intro #setup #live #timeline #results #why` | Sim chapters; a reload during a run lands on `#live` |
| `/nerds?tab=…` | Unchanged (+ `scenario=` for the Stepper) |
| `/device?account=…&device=…` | Focus mode: no sidebar or tab bar, slim top bar with a back link |

Hash updates use `replaceState` while scrolling (so Back leaves the page) and `pushState` for a rail click, Next button or palette jump (so Back undoes a deliberate jump) (`lib/story/history.ts`). Scroll positions are remembered per history entry (`lib/scrollMemory.ts`), restored on POP, and `history.scrollRestoration = 'manual'`.

## 4. Shell design

**The window is the only scroll container** (sticky stories, find-in-page, scroll restoration). Fixed sidebar + `padding-left: var(--sidebar-w)` on the content column (CSS transition 200 ms), not a grid track. Variables in `index.css`: `--topbar-h` 56 px, `--sidebar-w` (248 / 72 / 0), `--tabbar-h` 64 px on phones, `--safe-bottom`, `--stage-h`. Stories use `top: var(--topbar-h)` / `height: var(--stage-h)`.

| Width | Default | User can |
|---|---|---|
| ≥ 1280 | expanded (248) | collapse to a rail; preference persisted in `localStorage` (try/catch) |
| 768–1279 | rail (72) | expand as an **overlay** (scrim, no content shift) |
| < 768 | hidden | More sheet + tab bar |

Shortcuts: Cmd/Ctrl+B toggles the sidebar; Cmd/Ctrl+K palette; Alt+↓/↑ next/previous chapter; Esc closes overlays. Single-key shortcuts ignore typing targets (`isTypingTarget`). Skip link first; sidebar `<nav aria-label="Main">`, tab bar `<nav aria-label="Main (mobile)">` (one rendered per breakpoint); focus returns to the trigger after overlays; focus moves to the page `<h1>` on route change; `document.title` per route.

**Fixing the transform trap (D6):** the route wrapper animates with a CSS keyframe (`.route-enter { animation: reveal … backwards }`), never anime.js. A forwards-filling transform animation would keep a containing block alive for fixed descendants. A guard test forbids `enterUp('.page-content'`.

Components (each < ~200 lines): `components/shell/{AppShell,Sidebar,SidebarItem,TopBar,TabBar,MoreSheet,Tooltip,PhonePopover,ScrollChrome,nav}`, `lib/{shell.tsx,keys.ts,scrollMemory.ts,chrome.ts}`. Pages declare title/chapter/commands via `usePageMeta`.

## 5. The story framework

Two chapter kinds: **Scene** (120–320 svh; a sticky stage with a geometric scene scrubbed by local progress 0..1 and caption cards that swap at cut points; no controls) and **Work** (normal flow; forms and results; rises in once). **Gated** work chapters show a friendly placeholder until their prerequisite is met.

| File | Purpose |
|---|---|
| `lib/story/scrollBus.ts` | One passive scroll/resize listener and one rAF for the whole app; IntersectionObserver so only near-viewport scenes are measured; paused when the tab is hidden |
| `lib/story/progress.ts` | Pure maths: `progressFor`, `chapterAt`, `activeChapter` (unit-tested) |
| `lib/story/useScrollProgress.ts` | Progress ref for scenes + a state value that changes only at caption cuts |
| `components/story/Story.tsx` | Active chapter, hash sync, Alt+↑/↓, `goTo/next/prev`, `autoAdvance`, breadcrumb feed |
| `Chapter`, `StickyStage`, `ChapterRail`, `NextHint`, `ActionBar`, `AutoAdvanceToast` | Section anchor + landmark; sticky stage; right-edge geometric rail; end-of-chapter "Next"; floating action bar; "Jumped to your result · Back to <chapter>" |

Behaviour rules: active chapter = last whose top crossed 40% of the visible area; caption swaps are React state only at cuts (per-frame values stay in refs); programmatic scroll uses `scrollIntoView` with `scroll-margin-top`; **reduced motion** renders scenes at natural height with every caption listed in order; scenes' un-animated DOM is the finished picture (nothing starts hidden via JS); one scrubbed timeline at a time; only transform, opacity and stroke-dashoffset animate.

**Auto-advance (the one sanctioned programmatic scroll):** after Run/Compare/Start the page jumps to the result chapter only if the user has not scrolled, typed or clicked since pressing the button, the result arrived within 10 s, and the target is not already ≥ 50% visible; the toast offers a way back. Pure predicate: `lib/story/autoAdvance.ts` (tested).

**anime.js `onScroll` versus the custom bus:** `onScroll` exists in v4.5, but the shared bus + paused timeline scrubbed with `seek()` was used (works bidirectionally with clean teardown). Recorded in `docs/ui-voice.md`.

## 6. The geometric system

`components/geo/pieces.tsx`: `Slice` (the account / Melo), `DeviceShape` (laptop, phone, tablet, browser circle), `Crowd`, `Gate` (the limit), `Ring` (protection held), `Crack` (broken), `Counter`, `Bits`; `Glyph.tsx` has 16 px rail glyphs. `useGeoScene(svgRef, progressRef, build)` owns the paused timeline, `seek(p * 1000)` on change, the reduced-motion short-circuit and revert. `lib/motion.ts` gained `unfold`, `morphDots`, `breathe`. **Intro safety (D8):** intros use from-values, with a 2.5 s watchdog that completes the animation if rAF never runs.

## 7. Innovation shortlist (and outcome)

| # | Idea | Outcome |
|---|---|---|
| I1 | Scroll-scrubbed geo scenes per page | ✅ Home, Devices, Stress, Simulation |
| I2 | Gated chapters that unfold | ✅ (verdict, timeline, results); `unfold` helper exists |
| I3 | Data-true animation (stampede dots settle into the real result grid) | ✅ Stress; breach meter in Simulation |
| I4 | Shared-element route transition Home → Devices (View Transitions API) | ✅ implemented behind `FEATURES.viewTransitions` (Chromium / Safari 18; normal navigation elsewhere) |
| I5 | Scroll-aware chrome | ✅ |
| I6 | Geometric chapter rail | ✅ |
| I7 | Velocity-reactive ambient layer | ✅ (off for reduced motion and coarse pointers) |
| I8 | Soft snap for scene chapters on touch | ❌ evaluated, ruled out (fights tall chapters) |
| I9 | Auto-advance with undo | ✅ |
| I10 | Header title morph | ✅ |
| I11 | Swipeable device deck on phones | ✅ (native horizontal snap carousel) |
| I12 | Focus mode during live simulation runs | ✅ implemented behind `FEATURES.focusDuringRun` (on) |
| I13 | Chapter-aware palette | ✅ page commands in the palette |

Rejected: wheel/touch-hijacking slides, `scroll-snap: mandatory` on the page, parallax on text, cursor-follow effects beyond Melo's eyes, autoplaying sound.

## 8. Storyboards

### 8.1 My devices (`/devices`)
0 ⟐ **Meet your screens** (150 svh; the four device shapes assemble around a small slice, line up, the laptop lights up) · 1 ▣ **Your screens** (sticky status strip; compact device cards with one primary button and a "More" toggle, one expanded at a time; phones get a snap carousel with dots; **all four DeviceCards stay mounted** because each owns heartbeats and a socket) · 2 ▣ **Little missions** (one at a time; auto-detected where possible) · 3 ▣ **House rules** (gate picker 1–4, three policy cards) · 4 ▣ **Curious?** (nerds link, phone link + CopyConfirm, tour). ActionBar: Stop everything, Take the tour. The first-visit tour opens once the screens chapter is reached; returning visitors skip to `#screens`.

### 8.2 Stress test (`/stress`)
Chooser → scene (crowd rushes a gate that splits into six guards / blocks stack on a counter) → *How big is the stampede?* (slider, gate picker 1–3, Advanced) → *Who guards the door?* (method cards; CONSTRAINT disabled with a reason above 1) → *Let them in* (dots rush, then settle into a grid coloured by the real result) → *What happened?* (gated) → *Race them all* → *Go deeper*. Story B (Counting plays) mirrors it. Auto-advance after Run and Compare.

### 8.3 Simulation (`/sim`)
0 ⟐ **A whole city** · 1 ▣ **Set the scene** (scenario sidebar, story card, essentials; "More conditions" in tabs Crowd / Network / Trouble) · 2 ▣ **Watch it live** (sticky numbers strip with the breach meter, household cards or heatmap above 128 devices, feed as a right column ≥ xl or a slide-over below; live controls in the ActionBar: protection switcher, Pause/Resume, **Repair now**, Stop, Database) · 3 ▣🔒 **How it unfolded** (timeline with switch markers) · 4 ▣🔒 **The verdict** (verdict, numbers, compare with an earlier run) · 5 ▣ **Why did this happen?**. Start jumps to `#live`, Stop to `#results`; a reload mid-run lands on `#live`. This replaces `phase-sim.md` §5.1's layout and M4's phone Relay bottom sheet.

### 8.4 Home, Nerds, single device
Home = a scene chapter ("Meet Melo") + "Where to next?". Nerds: shell only, a sticky tab strip and breadcrumb; no stories or playful copy. `/device`: focus mode.

## 9. Copy additions
Chapter titles are questions or invitations (≤ 5 words); captions ≤ 2 sentences; gated placeholders say what unlocks them; NextHint "Next: <title> ↓"; toast "Jumped to your result · Back to <chapter>"; sidebar groups Listen / Experiment / Under the hood; tab labels Home, Devices, Stress, Simulation, More.

## 10. Milestones and tests
See the status table at the top. Unit tests (web): `progress`, `autoAdvance`, `history`, `shell`, `keys`, `scrollMemory`, `motion`, `theory`, `sim` reducer, and source guards (no `enterUp('.page-content'`, no `utils.set(... opacity: 0)` in scenes, no jargon in friendly-page string literals). Browser checklist (1440 / 1024 / 768 / 375, light and dark; reduced motion; hidden pane; keyboard-only; both demo scripts) is a manual step.

## 11. Risks
Story pages can feel slow to experts (mitigated by the ActionBar, palette commands, hash deep links, returning-visitor skip); sticky breakage from an `overflow` ancestor (the window is the only scroll container, a dev-only warning walks ancestors); DeviceCard unmounting would kill heartbeats (compact/expanded is a prop; all four stay mounted); two animation systems fighting over a node (one system per element); bundle growth (route code-splitting; initial JS ≈ 166 kB gzip).

## 12. Open questions and how they were resolved
1. Commit/branch: work stayed on `phase-nav`, uncommitted, at the owner's direction. 2. Mobile nav: labelled tab bar. 3. Focus mode during runs (I12): implemented and enabled. 4. Returning visitors skip intro scenes: yes. 5. Auto-advance with undo: yes. 6. Stress chooser via `?exp=`: yes. 7. QR code for "Use your phone": not added (URL + copy button). 8. Order of work: shell → framework → Devices → Stress → Sim. 9. Soft snap: ruled out. 10. Shared-element transition (I4): implemented behind a flag.

## Appendix: layout math
Desktop ≥ 1280 with the sidebar expanded: sidebar fixed 0..248; column `padding-left: 248px`; content max-width 1120 px centred; top bar sticky 56 px; scene section height = `heightSvh × 1svh`, sticky stage `top: 56px; height: calc(100dvh − 56px)`, local progress `p = clamp01(−(rect.top − 56) / (rect.height − (innerHeight − 56)))`; rail fixed right 16 px; action bar fixed bottom 20 px centred in the column. Tablet: rail 72 (overlay 248). Phone: no sidebar; tab bar fixed bottom 64 px + safe area; action bar sits above it (or at the safe area when the tab bar is hidden).
