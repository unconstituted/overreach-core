# Overreach Core

The ride engine for Overreach, a sci-fi story RPG ridden on an indoor bike trainer. Story chapters are structured workouts; your real power, cadence and heart rate drive the ship.

This repository is the engine: device connection, workout engine, chapter runtime, the visor HUD and the "feel" layer. It plays Chapter 1 end to end in desktop Chrome, with a real smart trainer over Bluetooth or with a simulated rider. The 3D view is placeholder art.

## Ride Chapter 1 in five minutes

You need Node 20 or newer and Chrome.

```
git clone https://github.com/unconstituted/overreach-core.git
cd overreach-core
npm install
npm run dev
```

Open the address it prints (normally `http://localhost:5173/`), leave the devices on **Simulated rider**, and press **Start ride**. No trainer needed.

During the ride:

| Key | Does |
| --- | --- |
| <kbd>Space</kbd> | Pause |
| <kbd>←</kbd> <kbd>→</kbd> | Skip 10 seconds (hold <kbd>Shift</kbd> for a minute) |
| <kbd>J</kbd> | Jump to a scene |
| <kbd>C</kbd> | Camera: auto, cockpit, chase |
| <kbd>H</kbd> | HUD at the top or bottom of the visor |
| <kbd>G</kbd> | Feel preset: off, restrained, standard, aggressive |
| <kbd>P</kbd> | Simulated rider stops or starts pedalling |
| <kbd>S</kbd> | Storyboard cut-aways on or off |
| <kbd>M</kbd> | Sound |
| <kbd>F</kbd> | Full screen |

Move the mouse for the control bar, which also has an effort slider for the simulated rider and **End ride**. The end screen shows the summary and a **Download .fit** button.

Useful addresses:

- `/?t=660` starts 11 minutes in.
- `/?chapter=test-clamp` plays the five-minute test chapter with a rider-data challenge.
- `/devices.html` is the device test page: live readings and manual trainer control.

## With a real trainer

Chrome or Edge on a desktop, trainer awake, other apps disconnected from it. On the start screen choose **Bluetooth…** for the trainer and for heart rate. The Bluetooth code is built to the specifications but has not yet met real hardware: work through `docs/TESTING-WITH-HARDWARE.md` on the first go.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit tests |
| `npm run build` | Type-check and build to `dist/` |
| `npm run lint` | ESLint, including the rule that keeps browser APIs out of the core |
| `npm run validate` | Check every chapter file against the schema and for sense |
| `npm run ride-script -- script.md` | Turn a ride-script table into a draft chapter |
| `npm run check:ride` | Ride the whole chapter headless and check the result (needs Playwright) |

## Where things are

```
chapters/      chapter data, voice clips and images (served as-is, never bundled)
schemas/       the chapter JSON schema
src/core/      pure, portable engine: workout, chapter runtime, feel maths, FIT, recording
src/devices/   device interfaces, Bluetooth protocols, simulated trainer and heart rate
src/web/       the browser ride view: world, HUD, audio, start and end screens
tools/         chapter validation, converters, headless checks
reference/     the prototypes this was ported from (do not edit)
docs/          the brief, progress log and the guides below
```

## Guides

- `docs/ARCHITECTURE.md`: how it fits together, and what ports to Unreal.
- `docs/AUTHORING.md`: how to write a chapter.
- `docs/TESTING-WITH-HARDWARE.md`: the checklist for the first ride on a real trainer.
- `docs/BRIEF.md` and `docs/PROGRESS.md`: the build plan and what was done at each stage.
- `CLAUDE.md`: ground rules for anyone, human or AI, working in this repository.
