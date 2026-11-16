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

## Non-goals

Final art, multiplayer, accounts, servers, mobile, outdoor GPS mode, Unreal itself.
