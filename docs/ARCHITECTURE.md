# Architecture

Overreach Core is a ride engine: it connects to a trainer, runs a workout, plays a story chapter in time with it, draws the ride and records it. This page explains how the pieces fit, and what would move to Unreal as it stands.

## The shape of it

```
chapters/*.chapter.json ──► ChapterRuntime ──► ChapterState (every track, at time T)
                               ▲      │              │
        rider data ────────────┘      │              ├──► World   (Three.js scene kits)
        (power, cadence, HR)          │              ├──► Stage   (visor HUD, story overlays)
              ▲                       ▼              └──► RideAudio (clips, sound bank, score)
     DeviceManager            one-shot events
     ▲           ▲            (dialogue, sfx, step, cue ...)
 Bluetooth    SimTrainer
 (FTMS, CPS,  SimHeartRate    FeelEngine ──► FeelState (strikes, peak line, speed factor)
  HRS)
                              RideRecorder ──► summary ──► FIT activity file
```

`src/web/ride/app.ts` is the only place that knows about all of them. (Around it sit the menus, described under "Content, player and menus" below.) Each frame it:

1. advances story time `T` by the wall clock;
2. asks the workout runner for the target, and tells the trainer (ERG target, or flat-road simulation when a step has ERG off);
3. ticks the devices and reads the latest power, cadence and heart rate;
4. updates the feel engine with that data;
5. calls `ChapterRuntime.advance(T, rider)`, which returns the state of every track plus the one-shot events crossed since the last frame;
6. feeds the recorder;
7. hands the state to the world, the stage and the audio.

## Folders

| Folder | What is in it | Portable to Unreal? |
| --- | --- | --- |
| `src/core/fit` | FIT codec: CRC, decoder, writer | Yes, as-is |
| `src/core/workout` | Workout model, `.zwo` and FIT workout parsers and writers, `WorkoutRunner` | Yes |
| `src/core/record` | 1 Hz recorder, bike-speed physics, summary stats, FIT activity export | Yes |
| `src/core/chapter` | Chapter types, curves, `ChapterRuntime`, semantic checks, ride-script converter | Yes |
| `src/core/feel` | The feel maths: strokes, peak hold, speed spring, presets | Yes |
| `src/core/content` | Types for workouts, plans, maps and seasons; unlock rules; the catalogue build; chapters generated from a workout or a map; the free-ride model | Yes |
| `src/core/player` | The player document (profile, progress, history, settings), migrations, `PlayerStore` over a storage-backend interface | Yes; swap the backend for a save game or a server |
| `src/core/settings` | The settings table and `rideConfig` | Yes: the table can drive any options menu |
| `src/core/plan` | Scheduling, missed sessions, pause and resume, matching a ride to a session | Yes |
| `src/core/progress` | Unlock evaluation and `applyRide` | Yes |
| `src/core/util` | Maths helpers, seeded random numbers, noise, dates, base64 | Yes |
| `src/devices/protocol` | FTMS, Cycling Power and Heart Rate packet parsing and building (pure functions) | Yes (the byte layouts are the Bluetooth specs) |
| `src/devices` | Device interfaces, `FtmsTrainer` control logic, simulators, `DeviceManager`, Web Bluetooth plumbing | Logic yes; `bluetooth.ts` is browser-only and would be replaced by the platform's BLE API |
| `src/web/ride` | World, stage (HUD and overlays), audio, the ride loop | No. This is the browser presentation layer and the part Unreal replaces |
| `src/web/menu` | The menu shell, screens, browser storage adapter | No. Functional prototypes of the flows; Unreal rebuilds them (in UMG or Common UI) on the same core |
| `content/` | Workouts, plans, maps, seasons | Yes: data |
| `chapters/`, `schemas/` | Chapter data and its JSON schema | Yes: the data is the contract |
| `tools/` | Chapter validation, the Chapter 1 port, the ride-script converter, headless checks | Build-time only |

### What "portable" means here

Everything under `src/core/` is plain TypeScript with no DOM, no Three.js and no browser APIs. This is enforced twice: ESLint bans browser globals and Three.js imports under `src/core/`, and `npm run build` type-checks the core a second time with the DOM library removed. The code is deterministic: no clocks, no `Math.random`, no timers. Time always comes in as an argument, and randomness comes from a seeded generator. A port to C# or C++ is a translation, not a redesign, and the unit tests describe the behaviour to match.

## Time: the central idea

A chapter is a function of time. `ChapterRuntime.stateAt(T)` returns the complete state of every track at `T`: which scene, the camera, the speed, every curve, which dialogue is mid-flight and how far into the clip, what is written on the glass, which HUD elements are up, the music direction. Nothing is accumulated, so any moment can be shown directly, and scrubbing works for free.

Two things are stateful, on purpose:

- **One-shots.** `advance(T)` reports events (a line starting, a sound, a step boundary) exactly once when time moves forward. A backwards step, or a jump of more than 1.5 s, is treated as a seek: no events fire, and the presentation layer resumes from `state.dialogue.active` instead.
- **Challenges.** Conditions on rider data ("hold 95 to 105% for 20 s") accumulate held time. When one resolves, its branch is injected into the tracks at that moment and may set story flags, which gate later items (`if` / `unless`). Seeking back before a result forgets it.

## Story pace against rider effort

The brief asks for a rider who stops pedalling to see the ship slow while the story keeps its pace. Those pull in different directions, because Chapter 1's scenery is placed by scripted distance: the warp ring has to arrive on the beat, with the dialogue.

The engine resolves it with two layers:

- **Story time and world placement follow the script.** `T` runs with the wall clock. The ship's position along the route is the integral of the chapter's `speed` track, so set pieces, dialogue, music and the workout never drift apart.
- **What the rider sees and hears follows their legs.** `FeelState.speedFactor` is 1 when the rider is on target, falls to about 0.12 when they stop, and rises a little above 1 when they push over. It scales the speed read-out, the speed streaks (their motion, length and brightness), the engine pitch and thrust, and the wind. With the feel layer on, each pedal stroke also kicks the speed, and above VO2 the spring is underdamped so it twitches.

So a coasting rider sees the number collapse, the streaks die and the engine wind down, while the scenery carries on at story pace. It is a deliberate compromise, and an honest limitation: the terrain itself does not slow. A fully rider-driven world would need chapters authored by distance rather than time, with the story waiting at gates. The challenge system is the first step in that direction, and the place to grow it.

## The chapter file

See `docs/AUTHORING.md` for the author's view. From the engine's side:

- `schemas/chapter.schema.json` checks structure; `checkChapter` (in `src/core/chapter/check.ts`) checks meaning: times in range, keyframes in order, workout length equal to chapter length, flags that are used but never set, missing clips and images. `npm run validate` runs both over every chapter.
- `chapters/ch1.chapter.json` is generated from the prototype by `tools/port-ch1-prototype.ts`, and the tests compare it against the prototype itself (loaded in a sandbox) so the port cannot drift. Once authors start editing Chapter 1 by hand, retire the port tool and those tests.
- Chapters are served as static files (`publicDir: 'chapters'` in `vite.config.ts`) and fetched at run time, with their clips and images alongside. They are never bundled, so a new chapter needs no build.

### What is data and what is still code

Data: the workout, dialogue and subtitles, glass text, stills, HUD items, scene segments, camera, speed, environment, every named curve, impacts, markers, props, streak settings, sound cues, music sections, ambience curves.

Code, keyed by an id the data refers to:

- **Scene kits** (`src/web/ride/world.ts`): `stills`, `tunnel`, `space`, `blackout`, `ice`, `ascent`, `orbit`, `end`. A kit is geometry and shaders, placeholder art by design. A chapter can reuse any of them; a new kind of place needs a new kit. Props (`warpRing`, `meteor`, `hangarChunk`, `steamColumn`, `downedShip`, `gate`) work the same way.
- **The sound bank** (`RideAudio.play`): `boom`, `riser`, `chime`, `whoosh`, `crack` and friends.
- **HUD widgets** (`src/web/ride/stage.ts`): `boot`, `call`, `boost`, `heat`, `map`, `tag`, `modes`, `canopy`, `fog`, `weird`; and effects `flicker`, `tear`, `alt`, `gate-flash`.

An unknown id is ignored (with a console warning for sounds), so a chapter written ahead of the code still plays.

## Content, player and menus

Three layers, kept apart on purpose:

- **Content** is what ships: chapters in `chapters/`, everything else in `content/`. `buildCatalogue` (`src/core/content/catalogue.ts`) reads all of it and writes one index, `content/catalogue.json`, holding the fields menus list and filter on (title, duration, estimated intensity and stress, a power graph, plan length, map length and climb, unlock rule). It is also where references are checked, so a plan cannot point at a workout that is not there. The catalogue is generated (and git-ignored): `tools/content.ts` does the file reading, and a small Vite plugin runs it on start-up, on every content change in development, and before a production build, where a problem fails the build.
- **Player state** is what the player owns: one versioned document (`PlayerData`) with profile, settings, progress and ride history, plus one `.fit` per ride stored beside it. `PlayerStore` talks to a four-method `StorageBackend`; the browser adapter uses IndexedDB and falls back to localStorage. Older documents are upgraded by `migrate`, one version at a time. Export is a single JSON file with the ride files inside it.
- **Screens** (`src/web/menu`) are functions from the app object to DOM. They hold no logic worth porting: everything they show comes from the core.

The flow of a ride from the menus:

1. `MenuApp.prepare(ref)` turns `chapter:<id>`, `workout:<id>` or `map:<id>` into a chapter to play. Story chapters are loaded as they are. A workout or a map becomes a chapter on the fly (`chapterFromWorkout`, `chapterFromMap`), so there is one runtime, one HUD and one recorder for everything.
2. `rideConfig(profile, settings)` produces the ride's configuration, and `RideApp` runs it as a session, with the season's story flags passed in as `initialFlags`.
3. When the ride ends, `applyRide` folds the result into the player: history, totals, chapter completion, flags, the plan session it counted for (`matchRide`), and anything newly unlocked. The post-ride screen shows what `applyRide` reports.

**Free rides** are the one place the rider drives distance. `FreeRide` integrates the bike model along the map's gradient profile; the app overrides the scene's speed and distance with its figures (times the map's `speedScale`), sends the grade to the trainer's simulation mode, and feeds the true road speed to the recorder. The ride ends at the end of the map.

**Settings** are one table (`src/core/settings/table.ts`). The options menu, validation of saved values, presets and the ride configuration all derive from it.

**Dates.** The core never asks what day it is. Callers pass today's date as an ISO string; `?today=2026-12-01` on the address overrides it in the browser, which is how the headless check (and you) can look at week 3 of a plan without waiting.

Opening `/?chapter=ch1` (or `?auto`) bypasses all of this and plays one chapter directly with its own small start and end screens. That path exists for development and for `npm run check:ride`.

## Devices

The game talks to three interfaces in `src/devices/types.ts`: `PowerSource`, `HeartRateSource` and `ControllableTrainer`. `DeviceManager` owns the current sources and exposes `live` readings.

- **Packet code is pure.** `protocol/ftms.ts`, `cps.ts` and `hrs.ts` parse and build bytes and are tested against fixtures written from the Bluetooth specifications.
- **`FtmsTrainer` holds the control logic** (request control, write queue, matching responses to requests, re-requesting control when the trainer drops it) against a small transport interface.
- **The simulator is a real peripheral, not a shortcut.** `SimFtmsPeripheral` implements that transport and answers with the bytes a physical trainer sends, so the same `FtmsTrainer` code runs against it. `SimTrainer` adds a rider: ERG lag and noise, following targets when ERG is off, a manual override, and stopping. `SimHeartRate` lags power with a slower recovery and some drift.
- **`bluetooth.ts`** is the only file that touches `navigator.bluetooth`. It handles reconnection and restores the last target afterwards. It has only been tested against a fake GATT stack; see `docs/TESTING-WITH-HARDWARE.md`.

## The feel layer

`FeelEngine` (`src/core/feel/feel.ts`) turns power and cadence into:

- **strokes**: two per crank revolution, each a "strike" whose strength depends on how it compares with the 10-second average;
- **a peak-hold line**: the best stroke of the last 30 seconds; breaking it is an event, with a short hit-stop;
- **intensity**: 0 below the onset (76% of FTP by default) rising to 1 by about 122%;
- **the speed factor**: a spring towards an effort-based target, critically damped at low effort and underdamped above VO2.

All parameters live in one `FeelConfig` object. `FEEL_PRESETS` has `off`, `restrained`, `standard` and `aggressive`. Rendering reads `FeelState`: the stage maps it to font weight, width, scale and colour split on the power number, lean on the speed number, and the hairline on the power rule; the audio maps it to the stroke tick and the peak-break clack.

## Recording and export

`RideRecorder` takes data at any rate and writes one sample per second, driven by the caller's clock, so pausing the ride pauses the recording. It keeps the game speed for interest, but the FIT file's speed and distance come from a flat-road physics model, so training platforms see plausible figures rather than 4,000 km/h. `encodeFitActivity` writes the messages in the order Garmin's devices do. Tests decode the output with the independent `fit-file-parser` library.

## Testing

- `npm test`: unit tests for everything in `src/core` and `src/devices`, including the property test on workout durations, FIT round trips, byte-level protocol fixtures, runtime seeking and the Chapter 1 port.
- `npm run validate`: schema and semantic checks on every chapter.
- `npm run check:menu`: builds, then walks the menus in headless Chromium: start a plan, ride today's session at accelerated time, see it completed and the plan advance, change settings and reload, come back three days later to a pushed session, free-ride a map, re-download a `.fit`, export and import, and confirm that a plan served purely as data shows up.
- `npm run check:ride`: builds, then rides the whole chapter in headless Chromium at accelerated time with the simulated rider, checks seeking and stop-pedalling behaviour, and decodes the downloaded `.fit`. It needs Playwright, which is not a project dependency.

## Known limits

- Bluetooth has never met a real trainer (none was available). The protocol code follows the specs and is tested at byte level, but expect to fix things on first contact.
- A `.fit` upload to Garmin Connect or Strava has not been tried; the file decodes cleanly with an independent decoder.
- The 3D view is placeholder art carried over from the prototype.
- The score is a procedural sketch, not music.
- Only cycling is modelled. The workout model has a `sport` field, but running needs its own targets (pace, not watts) and devices.
