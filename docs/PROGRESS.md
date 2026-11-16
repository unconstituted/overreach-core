# Progress

One entry per completed stage of docs/BRIEF.md.

- 2026-11-16: repository set up with CLAUDE.md, build brief and reference material (Chapter 1 prototype, HUD and feel-layer experiments, workout files).
- 2026-11-16: **Stage 0 done.** Vite + TypeScript + Vitest + ESLint skeleton. `npm run dev`, `npm test`, `npm run build`, `npm run lint` all work. ESLint blocks DOM globals and Three.js imports under `src/core/`, and the build type-checks the core a second time without the DOM library, so portability is enforced rather than promised.
