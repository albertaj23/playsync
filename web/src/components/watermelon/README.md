# Vendored Watermelon UI components

Copied from https://registry.watermelon.sh/r/<slug>.json on 2026-09-24 (each file's first line records its source and our edits).
Licence: the site describes itself as "open-source" but neither the site nor the registry JSON publishes licence text (checked 2026-09-25); confirm with the Watermelon authors before publishing this project.

| File | Slug | Edits |
|---|---|---|
| copy-confirm.tsx | copy-confirm | `motion/react` import; dropped full-screen wrapper |
| command-search.tsx | command-search | Cmd/Ctrl+K opens it; `placeholder` prop; free-form section names |
| feature-tour.tsx | feature-tour | non-null assertion for strict indexing |
| adaptive-slider.tsx | adaptive-slider | restyled: no card chrome, label + unit row, cyan→violet→coral gradient, glowing orb thumb, tick marks, theme tokens; native range input kept on top |

Rule: these use `motion`; everything we author uses anime.js (`src/lib/motion.ts`). Never animate one element with both.

fluid-tabs, dock, dialog-stack and feedback were removed in the nav phase (unused). Still in use: command-search (controlled: `open`/`onOpenChange`/`hideTrigger`), feature-tour, copy-confirm, adaptive-slider.
