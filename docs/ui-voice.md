# UI voice guide (friendly pages)

Friendly pages (Home, My devices, Device, Stress test): second person, short sentences, verbs first, no jargon (no lease, session, 409/410, HTTP, strategy identifiers), celebrate small wins, be kind in failures, never blame the user, at most one emoji per message and only where it adds meaning.
Stats for nerds stays technical and calm: monospace, precise terms, no playful copy.

| Instead of | Say |
|---|---|
| Playback moved to iPhone. | Your music hopped over to iPhone 🎧 |
| Playback stopped. This device stopped checking in | We lost touch, so we let this spot go. Tap Play to grab it back. |
| Protected: 1 device played, within the limit of 1. | Nice! Only 1 screen got in, exactly as allowed 🎉 |
| Broken: 30 devices are playing, but the limit was 1. | Whoa, 30 screens got in but only 1 was allowed. That's the bug we're hunting 🐛 |
| Loading… | Warming up the speakers… |
| 409 BUSY | Another experiment is running. Try again in a moment ⏳ |

Motion rules (see `web/src/lib/motion.ts`): anime.js for anything we author, `motion` only inside vendored Watermelon components, never both on one element; every preset is a no-op under prefers-reduced-motion; content is visible by default (animations only add motion).
Theme rules: use `stone-*`, `fg/N` overlays and `violet-*` (= brand coral) so both themes work; never `bg-white/N`, `text-white` or Tailwind `zinc-*` in our own files (Watermelon files keep their own `dark:` variants).


## Chapters and stories (phase-nav-ux)

- Chapter titles are questions or invitations, sentence case, max 5 words. Captions are max 2 sentences.
- Gated placeholders say what unlocks them ("Run the stampede to see what happens ↑"). NextHint reads "Next: <title> ↓". The auto-advance toast reads "Jumped to your result · Back to <chapter>".
- Sidebar groups: Listen, Experiment, Under the hood. Tab bar labels: Home, Devices, Stress, Simulation, More.
- Scroll never drives the user: native scroll always wins; every scrubbed step is also reachable by button and keyboard (Alt+Up/Down, rail, Next). Controls never live inside a scrubbed scene.
- Motion decision: our own scroll bus + a paused anime timeline (`seek`) is used, not `onScroll`. The route wrapper animates with a CSS keyframe (fill `backwards`), never anime.js, so it cannot leave a transform behind.
- Sliders: the Watermelon Adaptive Slider, restyled (cyan → violet → coral fill, glowing orb thumb, animated digits).
