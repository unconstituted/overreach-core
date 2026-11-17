# Overreach Core

The ride engine for Overreach, a sci-fi story RPG ridden on an indoor bike trainer, or run on a treadmill. Story chapters are structured workouts; your real power, cadence and heart rate drive the ship.

This repository is the engine: device connection, workout engine, chapter runtime, the visor HUD and the "feel" layer. It plays Chapter 1 end to end in desktop Chrome, with a real smart trainer over Bluetooth or with a simulated rider. The 3D view is placeholder art.

## Ride Chapter 1 in five minutes

You need Node 20 or newer and Chrome.

```
git clone https://github.com/unconstituted/overreach-core.git
cd overreach-core
npm install
npm run dev
```

Open the address it prints (normally `http://localhost:5173/`). On Home, press **Ride** under "Continue the season", leave the devices on **Simulated rider**, and press **Start ride**. No trainer needed.

The menus also have training plans, a workout library, maps for free riding, your ride history and settings. Everything you do is saved in the browser.

During the ride:

| Key | Does |
| --- | --- |
| <kbd>Space</kbd> | Pause |
| <kbd>←</kbd> <kbd>→</kbd> | Skip 10 seconds (hold <kbd>Shift</kbd> for a minute) |
| <kbd>J</kbd> | Jump to a scene |
| <kbd>C</kbd> | Camera: auto, cockpit, chase |
| <kbd>H</kbd> | HUD at the top or bottom of the visor |
| <kbd>G</kbd> | Feel preset: off, restrained, standard, aggressive |
| <kbd>P</kbd> | Simulated rider stops or starts pedalling (or the simulated runner presses stop) |
| <kbd>S</kbd> | Storyboard cut-aways on or off |
| <kbd>M</kbd> | Sound |
| <kbd>F</kbd> | Full screen |

Move the mouse for the control bar, which also has an effort slider for the simulated rider and **End ride**. The screen after the ride shows the summary, your plan progress, anything unlocked, and a **Download .fit** button.

Useful addresses:

- `/?chapter=ch1&t=660` plays Chapter 1 directly, 11 minutes in, without menus or saved progress.
- `/?chapter=test-clamp` plays the five-minute test chapter with a rider-data challenge.
- `/?today=2026-12-01` opens the menus as if it were that date, to see how a plan looks later on.
- `/devices.html` is the device test page: live readings and manual trainer control.

## Running

On the screen before any session, choose **Run**. Running workouts and the Ground Crew plan are run-only; chapters and cycling workouts can be ridden or run, and every power target becomes a pace at the same effort. Set your threshold pace in Settings → Rider first. With no treadmill to hand, the simulated runner does the work, on a simulated treadmill with a footpod.

On a run, pace replaces watts on the visor, the treadmill follows the workout (turn **Treadmill control** off in Settings → Devices to set the belt yourself), and the `.fit` file is a treadmill run. If you press the treadmill's stop button or pull the safety key, the run pauses and the game leaves the belt stopped until you press play.

`/?chapter=ch1&sport=run` runs Chapter 1 directly.

## With a real trainer

Chrome or Edge on a desktop, trainer awake, other apps disconnected from it. On the screen before a ride, choose **Bluetooth…** for the trainer and for heart rate (or, on a run, for the treadmill and footpod). The Bluetooth code is built to the specifications but has not yet met real hardware: work through `docs/TESTING-WITH-HARDWARE.md` on the first go.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit tests |
| `npm run build` | Type-check and build to `dist/` |
| `npm run lint` | ESLint, including the rule that keeps browser APIs out of the core |
| `npm run validate` | Check every chapter and content file against its schema, and every reference between them |
| `npm run catalogue` | Rebuild the content index (`dev` and `build` do this for you) |
| `npm run ride-script -- script.md` | Turn a ride-script table into a draft chapter |
| `npm run check:ride` | Ride the whole chapter headless and check the result (needs Playwright) |
| `npm run check:run` | Run Chapter 1 and a plan session on the simulated treadmill, headless, and check the result (needs Playwright) |
| `npm run check:menu` | Walk the menus headless: plan, ride, progress, settings, free ride (needs Playwright) |

## Where things are

```
chapters/      chapter data, voice clips and images (served as-is, never bundled)
content/       workouts, plans, maps and seasons (also data, also never bundled)
schemas/       JSON schemas for chapters and content
src/core/      pure, portable engine: workout, chapter runtime, feel maths, FIT, recording,
               content catalogue, player state, settings, plans and progression
src/devices/   device interfaces, Bluetooth protocols (trainers, treadmills, footpods, heart rate) and their simulated twins
src/web/       the browser: the ride view (world, HUD, audio) and the menu screens
tools/         chapter validation, converters, headless checks
reference/     the prototypes this was ported from (do not edit)
docs/          the brief, progress log and the guides below
```

## Guides

- `docs/ARCHITECTURE.md`: how it fits together, and what ports to Unreal.
- `docs/AUTHORING.md`: how to write a chapter, a workout, a plan, a map or a season.
- `docs/TESTING-WITH-HARDWARE.md`: the checklist for the first session on a real trainer, treadmill or footpod.
- `docs/BRIEF.md` and `docs/PROGRESS.md`: the build plan and what was done at each stage.
- `CLAUDE.md`: ground rules for anyone, human or AI, working in this repository.
