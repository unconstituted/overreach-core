# Overreach Core: build brief

Goal: a ride engine that runs in desktop Chrome, plays Chapter 1 end to end from a data file, driven by a real smart trainer and heart-rate strap when present and by a simulated rider when not. Build it in the stages below, in order. Each stage ends with tests passing, a build, a commit and an entry in `docs/PROGRESS.md`.

## Stage 0: skeleton

- Vite + TypeScript + Vitest + ESLint. Folders: `src/core`, `src/devices`, `src/web`, `chapters`, `schemas`, `tools`, `test`.
- `npm run dev`, `npm test`, `npm run build`, `npm run lint`.
- **Done when:** an empty page builds and a trivial test passes.

## Stage 1: workout engine (`src/core/workout`)

- A workout model: steps of steady state, ramp, interval sets, free ride, each with duration, target (% FTP or watts), cadence target (optional), ERG on/off flag, text events at offsets.
- Parsers: `.zwo` (Zwift XML, including `textevent`, `Ramp`, `IntervalsT`, `FreeRide`, `Cooldown`, `Warmup`) and `.fit` workout files (the FIT `workout` and `workout_step` messages). Use `reference/workouts/` as fixtures.
- A runner: given elapsed time, returns current step, target watts for a given FTP, time left in step, next step, and upcoming cues ("spin up in 5" five seconds before any step at 100%+ FTP).
- **Done when:** both reference workouts parse; ramp maths, interval repeats and cue timing are unit-tested; a property test confirms total duration equals the sum of steps.

## Stage 2: ride recording and FIT activity export (`src/core/record`)

- Record 1 Hz samples: power, cadence, heart rate, speed (game speed and a realistic "bike speed" from a simple physics model), distance, elapsed time, lap markers at step boundaries.
- Export a valid FIT **activity** file (file_id, device info, records, laps, session, activity) that Garmin Connect and Strava accept. Write the FIT encoder yourself or use a well-maintained MIT library; include CRC.
- Summary stats: duration, average and normalised power, kJ, average and max HR, time in zones.
- **Done when:** an exported file decodes cleanly with an independent FIT decoder in tests, and NP/kJ maths match hand-computed fixtures.

## Stage 3: devices (`src/devices`)

- Common interfaces: `PowerSource` (power, cadence, speed events), `HeartRateSource`, `ControllableTrainer` (set ERG target watts, set simulation grade/resistance, release).
- **Bluetooth (Web Bluetooth, Chrome):**
  - FTMS (Fitness Machine Service 0x1826): Indoor Bike Data parsing, Control Point (request control, set target power, set indoor bike simulation parameters, reset), status notifications.
  - Cycling Power Service (0x1818) as a read-only fallback (crank revolution maths for cadence).
  - Heart Rate Service (0x180D), including watches that broadcast HR.
  - Reconnect handling, and a clear device-picker UI.
- **Simulated twins:** `SimTrainer` (responds to ERG targets with realistic lag and noise, models a rider who follows targets, with keyboard/slider override) and `SimHeartRate` (lags power by 20 to 60 s like a real heart).
- Packet parsing is in pure functions and unit-tested with byte fixtures written from the Bluetooth specs.
- **Done when:** the dev page can switch between Sim and Bluetooth sources; all parsers have byte-level tests; ERG control is exercised end to end against `SimTrainer`.

## Stage 4: chapter format and runtime (`chapters/`, `schemas/`, `src/core/chapter`)

- A JSON schema for a chapter: metadata, workout (inline steps or a referenced file), and timed tracks: `dialogue` (clip, speaker, subtitle text, gain, optional radio filter), `glass` (text written in the canopy condensation, hold time), `hud` events (show/hide elements, banner, pop-up notices: location, distance, AI line, surge cue, warning), `scene` (scene id, camera mode, speed curve keys, environment keys), `sfx` cues, `music` direction.
- A runtime that, given elapsed time and live rider data, emits the active state for every track. Seeking forwards and backwards must be correct (dialogue resumes mid-clip, one-shot effects do not refire when seeking back).
- Hooks for future gameplay: a track can declare conditions on rider data (e.g. "hold 95 to 105% for 20 s to lock the clamp"), with success and fail branches. Implement the condition evaluator and a test chapter that uses it, even though Chapter 1 does not.
- **Converter** `tools/ride-script-to-chapter.ts`: takes the ride script exported as Markdown (table columns Time, Workout, What we see, What we hear, Dialogue, HUD / gameplay) and produces a draft chapter JSON with timed beats and dialogue lines, flagging anything it cannot map. A draft for an author to refine, not a perfect translation.
- **Done when:** `chapters/ch1.chapter.json` validates and reproduces the timeline in `reference/ch1-prototype/a_core.js` (intervals, cues, glass text, stills); runtime seeking is tested; the converter round-trips a sample table.

## Stage 5: Chapter 1 on the engine (`src/web`)

- Port the prototype's world (`b_world.js`), audio (`c_audio.js`) and HUD onto the engine, driven entirely by `ch1.chapter.json` and live rider data rather than hard-coded tables.
- Replace the prototype HUD with the visor HUD direction in `reference/hud/visor-hud.html`: holographic numbers on the curved visor, watts and speed as the hero numbers, the centre reserved for AI lines and notices.
- The feel layer from `reference/hud/peak-hold-feel.html`, driven by real data: stroke-timed strikes from cadence, a 30-second peak-hold line, twitchier speed response above VO2, intensity scaling with zone. All feel parameters in one config object with presets (Restrained, Standard, Aggressive) and a toggle to turn it off.
- Speed must feel dramatically faster than conventional cycling games: wide field of view at speed, streaks, shake on surges, edge blur.
- Start screen: FTP, max HR, device choice (Sim or Bluetooth), feel preset. End screen: ride summary and **Download .fit**.
- **Done when:** Chapter 1 plays 35 minutes end to end with the simulated rider and no console errors; seeking works; a .fit downloads and decodes; a rider who stops pedalling sees the ship slow but the story keep its pace.

## Stage 6: polish and handover

- `docs/ARCHITECTURE.md`: modules, data flow, what is portable to Unreal and what is not.
- `docs/AUTHORING.md`: how to write a new chapter file.
- A short `docs/TESTING-WITH-HARDWARE.md` checklist for when a real trainer is available.
- **Done when:** a new person can clone, `npm install`, `npm run dev`, and ride Chapter 1 with the simulated rider in under five minutes.

## Stage 7: content catalogue, player state and menus

Stages 0 to 6 play one chapter. This stage builds everything around it: the content the game ships with, what the player owns, and the screens that tie them together. The rule from chapters holds: **adding a plan, workout, map or season never needs code.**

### 7a. Content types (`content/`, `schemas/`, `src/core/content`)

Each type gets a folder, a JSON schema, TypeScript types and semantic checks (as `checkChapter` does), and `npm run validate` covers them all.

- **Workouts** (`content/workouts/`): standalone sessions. Accept `.zwo`, `.fit` and our own JSON (`buildWorkout` steps) plus a metadata sidecar or block: id, title, description, sport, duration (derived), tags, focus (endurance, threshold, VO2 and so on), difficulty.
- **Plans** (`content/plans/`): id, title, description, sport, level, goal, hours per week (range), length in weeks, and `weeks[] → days[] → sessions[]`. A session refers to `workout:<id>` or `chapter:<id>`, may be marked optional, and may give alternatives (a shorter or easier swap). Plans can be calendar-led (a TrainerRoad-style block) or story-led (a season's chapters with training around them); the schema must allow both.
- **Maps / routes** (`content/maps/`): id, title, scene kit id, length, terrain profile (distance and grade keys), preview image, free-ride or chapter use, unlock rule.
- **Seasons** (`content/seasons/`): id, title, ordered chapters, the story flags carried between them, and unlock rules.
- **Unlock rules** are data, from a small vocabulary: chapter completed, flag set, total distance or time ridden, plan week reached, always. No scripting language.
- A **catalogue build** (`npm run catalogue`, also run by `dev` and `build`) reads every content folder and the chapters and writes one index: id, type, title, summary fields for filtering, and file path. Menus read the index; they open a file only when shown in detail. Broken references (a plan pointing at a missing workout) fail the build.
- Placeholder content to prove it: **three plans** (an 8-week cycling base plan, a 4-week story-led plan built around Season 1, a short sampler), **about twelve workouts** covering the main focuses, **three maps** using existing scene kits, and **Season 1** listing Chapter 1 and the test chapter. Titles and descriptions in the game's voice, British English.

### 7b. Player state (`src/core/player`)

Kept strictly apart from content.

- **Profile**: name, FTP, max and resting heart rate, threshold pace (for running later), weight (for the speed model), units (metric or imperial).
- **Progress**: active plan and its start date, completed sessions with links to ride records, chapter completion, story flags per season, unlocks, totals (time, distance, kJ).
- **Ride history**: the summary of each ride plus its `.fit` bytes.
- **Settings**: see 7c.
- One `PlayerStore` interface with load, save, export and import, and a schema version with migrations. The core holds the logic; a browser adapter (IndexedDB, falling back to localStorage) lives in `src/web`. Export and import as a single JSON file, so a player can move devices and so tests can load fixtures.

### 7c. Settings as data

- Every setting declared once in a table: key, type (toggle, choice, number with range and step, slider), default, label, help text, category (Rider, Display, HUD, Feel, Audio, Devices, Accessibility), and whether it applies mid-ride.
- One renderer builds the whole options menu from the table, with reset-to-default per category.
- Fold in what already exists: feel preset and individual feel parameters, HUD top or bottom, storyboard cut-aways, audio levels (master, dialogue, music, effects), subtitles on or off and size, camera default, units, reduced motion (turns off shake, strikes and hit-stop).

### 7d. Plan and progression logic (`src/core/plan`, `src/core/progress`)

Pure and unit-tested, like the rest of the core.

- **Scheduling**: turn a plan and a start date into dated sessions; show today, this week and what is next; handle rest days and the player's chosen training days.
- **Missed sessions**: push the rest of the week, or skip; never stack two hard days back to back. Keep the rules simple and documented.
- **Completion matching**: a ride counts against today's session when it is that workout or chapter, or when its duration and intensity are close enough; free rides do not count.
- **Unlocks**: evaluate the rules against progress after each ride and report what newly unlocked, so the post-ride screen can show it.
- **FTP changes**: when the player updates FTP, nothing in the content changes (targets are fractions), but history keeps the FTP each ride used.

### 7e. Screens (`src/web/menu`)

Plain and functional: these prove the flows and the data, and Unreal will rebuild the look. Reuse the existing styles; no framework needed.

- A tiny screen router (hash-based, back button works).
- **Home**: today's session, continue the season, quick ride, recent rides.
- **Season**: chapters in order, locked and unlocked, progress.
- **Plans**: browse and filter (sport, level, hours, length); plan detail with a week-by-week calendar; start, pause or leave a plan.
- **Workouts**: library with filters (focus, duration, difficulty) and a power graph per workout.
- **Maps**: list with preview, length and terrain profile; free ride on a map.
- **Profile and history**: stats, ride list, re-download any `.fit`.
- **Settings**: generated from 7c.
- **Pre-ride**: what you are about to ride, devices, feel preset. **Post-ride**: the existing summary, plus plan progress and anything unlocked.
- Shared components: card grid with filters, detail page, calendar, form. Keyboard navigable, readable at 1280 × 720 and on a laptop.
- **Free ride on a map** needs a minimal runtime: a chapter generated on the fly from the map (scene kit, speed from the rider's power through the bike model, grade from the terrain profile into the trainer's simulation mode). Keep it simple; it proves maps are usable.

**Done when:** every content type validates, broken references fail the build, and the catalogue builds; a new plan or workout added as a file appears in the menus without code changes (tested); the player store round-trips through export and import and migrates an older version (tested); scheduling, missed-session handling, completion matching and unlocks are unit-tested; a headless check walks Home → Plans → start a plan → today's session → ride (accelerated) → post-ride shows the session completed and the plan advanced → Settings change persists after reload; and `docs/AUTHORING.md` gains sections for plans, workouts, maps and seasons.

## Stage 8: running

The workout model is cycling-only. Extend it so the same plans, menus and chapters work for treadmill running.

- Targets by **pace** (fraction of threshold pace, or absolute) and by **heart rate**, alongside power. Running power (from footpods that report it) as an option.
- Parse running targets from `.zwo` (Zwift run workouts use pace) and `.fit`.
- Devices: **FTMS Treadmill Data** (speed, incline), **Running Speed and Cadence Service** (0x1814) footpods, heart rate. Treadmill control (target speed and incline) where the treadmill allows it. Simulated twins: `SimTreadmill`, a runner who follows targets.
- Feel layer for running: strides (from cadence) instead of pedal strokes; the rest of the maths is reused with running thresholds.
- Recording and `.fit` export as a run (sport 1, sub-sport treadmill or virtual activity) with distance from the treadmill or footpod.
- HUD: pace replaces watts as the hero number when running; units follow settings (min/km or min/mile).
- A sample running plan and two running workouts; Chapter 1 playable as a run with its targets mapped to pace.

**Done when:** a running workout and a running plan validate and play with the simulated runner; pace maths and RSC and treadmill packet parsing are unit-tested with byte fixtures; a run `.fit` decodes with the independent decoder as a run; and `docs/TESTING-WITH-HARDWARE.md` gains a treadmill and footpod section.

## Non-goals

Final art, multiplayer, accounts, servers, mobile, outdoor GPS mode, Unreal itself. Menu screens are functional prototypes, not final UI.
