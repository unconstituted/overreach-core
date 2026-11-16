# Overreach Core

Overreach is a sci-fi story RPG played on an indoor bike trainer (later running too). Story chapters are ridden as structured workouts; the player's real power, cadence and heart rate drive the ship. This repository is the **ride engine**: device connection, workout engine, chapter runtime and the HUD/feel layer. Final art does not exist yet and is not this repo's job.

Read `docs/BRIEF.md` before starting work. It is the build plan and the acceptance criteria.

## Ground rules

- **Language and stack:** TypeScript, Vite, no framework for the core (plain modules). Three.js is allowed for the ride view. Vitest for tests. Node 20+.
- **Engine-agnostic core.** Everything under `src/core/` (workout engine, chapter runtime, FIT/ZWO parsing and export, the feel maths) must have **no DOM, no Three.js, no browser APIs**. It must be pure, deterministic, unit-tested code that could be ported to C#/C++ for Unreal later. Browser-only code lives in `src/web/` and `src/devices/`.
- **No trainer is available.** Every device has a simulated twin (`SimTrainer`, `SimHeartRate`) that behaves like the real protocol. Real Bluetooth (Web Bluetooth, Chrome only) is built to spec and covered by tests against recorded/simulated packets.
- **Data over code.** Chapters are data files (`chapters/*.chapter.json`), and plans, workouts, maps and seasons live in `content/`, all validated by JSON schemas. Adding content must never require code changes. Player state (profile, progress, settings, ride history) is kept separate from content.
- **Commit in stages.** One stage of the brief per commit or small group of commits, each with passing tests and a short note in `docs/PROGRESS.md`.
- **Tests must pass** (`npm test`) and `npm run build` must succeed before every commit.
- **Do not modify `reference/`.** It holds the prototypes and assets to port from.
- British English in all player-facing text.

## Reference material in this repo

- `reference/ch1-prototype/`: the working Chapter 1 browser prototype (single-file build via `build.py`). `a_core.js` holds the workout intervals, speed curve, dialogue cues, glass text and stills: the de facto Chapter 1 data. `b_world.js` is the Three.js world, `c_audio.js` the procedural audio and dialogue playback, `d_main.js` the loop. `clips/` are the voiced dialogue lines (ElevenLabs), `img/` storyboard frames.
- `reference/hud/visor-hud.html`: the chosen HUD direction (holographic numbers projected on the curved visor). `peak-hold-feel.html` and `feel-lab.html`: the arcade "feel layer" experiments (stroke-as-hit, peak hold, twitch at VO2+).
- `reference/workouts/`: `CrushCh1.fit` (Chapter 1 workout, Garmin) and `Rubicon_Storm_Front.zwo` (Zwift format sample with text events).
- The Chapter 1 ride script (source of truth for story beats) is a Claude Doc: https://claude.ai/artifact/LsJ2AFi9QyALmTSsyQr9eB. Table columns: Time, Workout, What we see, What we hear, Dialogue, HUD / gameplay.
