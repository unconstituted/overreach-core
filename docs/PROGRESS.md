# Progress

One entry per completed stage of docs/BRIEF.md.

- 2026-11-16: repository set up with CLAUDE.md, build brief and reference material (Chapter 1 prototype, HUD and feel-layer experiments, workout files).
- 2026-11-16: **Stage 0 done.** Vite + TypeScript + Vitest + ESLint skeleton. `npm run dev`, `npm test`, `npm run build`, `npm run lint` all work. ESLint blocks DOM globals and Three.js imports under `src/core/`, and the build type-checks the core a second time without the DOM library, so portability is enforced rather than promised.
- 2026-11-16: **Stage 1 done.** Workout engine in `src/core/workout`: model with steady, ramp, interval sets and free ride; `.zwo` parser and writer (own DOM-free XML reader); FIT workout parser and writer on a shared FIT codec in `src/core/fit` (decoder, writer, CRC); a time-stateless `WorkoutRunner` with targets, next step, text events and "spin up in 5" cues. Both reference workouts parse (Storm Front: 52 steps, 60 min; CrushCh1: 37 steps, 35 min, 7 efforts at 100%+). Note: `CrushCh1.fit` and the prototype's interval table in `a_core.js` differ in places (step boundaries and some targets); Stage 4 treats `a_core.js` as the Chapter 1 source, as the brief says.
