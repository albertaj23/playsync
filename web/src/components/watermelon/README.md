# Vendored Watermelon UI components

Copied from https://registry.watermelon.sh/r/<slug>.json on 2026-09-24 (each file's first line records its source and our edits).
Licence text not yet verified; confirm at the Watermelon repository before publishing this project.

| File | Slug | Edits |
|---|---|---|
| copy-confirm.tsx | copy-confirm | `motion/react` import; dropped full-screen wrapper |
| fluid-tabs.tsx | fluid-tabs | react-icons to lucide; controlled `activeId` prop |
| dock.tsx | dock | hugeicons to lucide; `activeId`/`onSelect`/`label` props; no page background |
| command-search.tsx | command-search | Cmd/Ctrl+K opens it; `placeholder` prop; free-form section names |
| feature-tour.tsx | feature-tour | non-null assertion for strict indexing |
| dialog-stack.tsx | dialog-stack | hugeicons removed; icons passed as React nodes (not yet used) |
| feedback.tsx | feedback | hugeicons/react-icons to lucide (not yet used) |

Rule: these use `motion`; everything we author uses anime.js (`src/lib/motion.ts`). Never animate one element with both.
