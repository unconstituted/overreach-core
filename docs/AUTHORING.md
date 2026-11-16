# Writing a chapter

A chapter is one JSON file in `chapters/`, named `<id>.chapter.json`, plus a folder of voice clips and images. Writing one never needs a code change. This page walks through the file, section by section.

All times are **seconds from the start of the chapter**. All player-facing text is in British English.

## The quick route

1. Write the ride script as a table in the usual columns: Time, Workout, What we see, What we hear, Dialogue, HUD / gameplay.
2. Export it from Claude Docs as Markdown.
3. Convert it:
   ```
   npm run ride-script -- path/to/ride-script.md chapters/ch2.chapter.json --id ch2 --title "The Descent"
   ```
   The tool writes a draft and prints a list of everything it guessed or could not map. It is a first draft for you to refine, not a finished chapter.
4. Check it: `npm run validate`
5. Ride it: `npm run dev`, then open `http://localhost:5173/?chapter=ch2`

While you work, add `&t=600` to the address to start ten minutes in, and press <kbd>J</kbd> in the ride for the scene list.

## Skeleton

```json
{
  "$schema": "../schemas/chapter.schema.json",
  "format": 1,
  "id": "ch2",
  "title": "Chapter 2",
  "subtitle": "The Descent",
  "season": 1,
  "number": 2,
  "duration": 2400,
  "assets": { "clips": "ch2/clips", "images": "ch2/images" },
  "workout": { "steps": [] },
  "scene": { "segments": [{ "from": 0, "id": "space" }], "speed": [[0, 100], [2400, 100]] }
}
```

The `$schema` line gives you completion and red underlines in VS Code. `duration` must equal the workout's total length; the validator tells you if it does not.

`chapters/test-clamp.chapter.json` is a small complete example. `chapters/ch1.chapter.json` is a full one.

## Workout

Either inline steps, or a file:

```json
"workout": { "file": "ch2/descent.zwo" }
```

`.zwo` (Zwift) and `.fit` (Garmin workout) files are both read. Inline steps come in four kinds:

```json
{ "kind": "steady", "duration": 120, "power": 0.65, "label": "Above the atmosphere" }
{ "kind": "ramp", "duration": 90, "from": 0.65, "to": 0.8, "label": "Re-entry" }
{ "kind": "intervals", "repeat": 4, "on": { "duration": 20, "power": 1.15, "label": "Burn" }, "off": { "duration": 40, "power": 0.6, "label": "Drift" } }
{ "kind": "free", "duration": 60, "label": "Your call" }
```

- `power` is a fraction of FTP: `1.0` is FTP, `1.15` is 115%. Use `watts` instead for an absolute target.
- `cadence` (rpm) is optional.
- `"erg": false` hands resistance back to the rider for that step. Use it for surges, where ERG mode feels like hitting a wall.
- `label` is what the rider sees. Keep it short.
- The engine adds a "spin up" countdown five seconds before any step at 100% of FTP or more. You do not write those.

## Dialogue

```json
"dialogue": [
  {
    "t": 334, "clip": "call", "gain": 1,
    "subs": [
      { "offset": 0.2, "duration": 1.0, "speaker": "SARAH", "text": "Comms check." },
      { "offset": 1.4, "duration": 1.1, "speaker": "CRUSH", "text": "Loud and clear." }
    ]
  }
]
```

- `clip` is the file name in the clips folder, without `.mp3`. One clip can hold a whole exchange; `subs` times each line from the start of the clip.
- Lines spoken by `AI` appear in the centre of the visor with a waveform. Everyone else gets a subtitle at the bottom.
- Optional: `gain` (volume), `rate` (playback speed), `radio: true` (band-limited, for comms), `reverb: true` (a voice in a big space or on an open channel).
- `duration` is the clip length in seconds. It is only a hint for tools; the player measures the real file.

Music and effects duck automatically while a subtitle is up.

## Glass

The AI writing in the canopy condensation:

```json
"glass": [{ "t": 905, "text": "STAY CALM.", "hold": 9 }]
```

Text is written out letter by letter, held for `hold` seconds, then fades over three. Use `\n` for a second line. Keep it under about 40 characters a line.

## Stills

Storyboard frames, shown full screen with a slow move:

```json
"stills": [{
  "image": "s05", "from": 571, "to": 580.5, "fadeIn": 1, "fadeOut": 1.2,
  "start": [1.12, 2, 0], "end": [1.02, -1, 0], "insert": true
}]
```

`start` and `end` are `[scale, x %, y %]`. `"visor": true` draws the HUD over the still (we are looking through the helmet). `"insert": true` marks a short cut-away the player can switch off.

## HUD

A list of items, each with a `type`:

| Type | What it does | Example |
| --- | --- | --- |
| `title` | A title card | `{ "type": "title", "from": 1.5, "to": 15, "fadeIn": 2.5, "small": "OVERREACH · SEASON 1", "big": "CHAPTER 2", "em": "The Descent" }` |
| `notice` | A pop-up in the centre of the visor | `{ "type": "notice", "t": 700, "hold": 6, "kind": "location", "text": "Terror · Impact Zone" }` |
| `banner` | A held centre message | `{ "type": "banner", "from": 657, "to": 776, "text": "AI CONTROL", "tone": "warning", "blink": true }` |
| `waypoint` | A marker with a live read-out | `{ "type": "waypoint", "from": 1242, "to": 1320, "label": "COVER", "distanceTo": 1322, "unit": "km", "decimals": 1, "x": 50, "y": 46 }` |
| `hide` | Hides standard elements for a while | `{ "type": "hide", "from": 776, "to": 990, "elements": ["all"] }` |
| `widget` | A story-specific element | `{ "type": "widget", "id": "boost", "from": 736, "to": 772, "params": { "fillFrom": 740, "fillTo": 768 } }` |
| `effect` | A treatment of the whole HUD | `{ "type": "effect", "id": "tear", "from": 770, "to": 776 }` |

Notes:

- Notice `kind` is one of `location`, `distance`, `ai`, `surge`, `warning`, `info`. Warnings stack down the right side in red; the rest take the centre one at a time.
- A waypoint's `distanceTo` is a *time*: the read-out shows how far the ship is from where it will be at that moment. Or give `value` keyframes for any number you like.
- `hide` elements: `all`, `speed`, `power`, `cadence`, `heartRate`, `target`.
- Widgets that exist today: `boot` (start-up text), `call` (an incoming call), `boost` (a charge bar), `heat` (a gauge driven by the rider's real power), `map` (heading and altitude), `tag` (a bracket on something in the world), `modes` (two lines of text), `canopy` (the cockpit frame), `fog` (canopy condensation), `weird` (images that drift in the dark). Look at Chapter 1 for their `params`.
- Effects: `flicker`, `tear`, `alt` (violet tint), `gate-flash`.

A widget or effect the engine does not know is ignored, so you can write ahead of the code and ask for it to be built.

## Scene

```json
"scene": {
  "segments": [{ "from": 0, "id": "stills" }, { "from": 300, "id": "tunnel" }, { "from": 497, "id": "space" }],
  "defaultCamera": "cockpit",
  "camera": [{ "from": 570, "to": 626, "mode": "chase" }],
  "speed": [[0, 1.3], [478, 14], [510, 120], [570, 900]],
  "curves": { "fov": [[0, 64], [480, 70], [510, 96]], "shake": [[0, 0], [480, 0.4]] },
  "impacts": [{ "t": 770, "strength": 1 }],
  "env": [{ "t": 497, "values": { "top": [0.02, 0.02, 0.06], "bot": [0.1, 0.05, 0.2], "stars": 1 } }]
}
```

- `segments` say which scene kit is on screen from when. Kits today: `stills` (black, for storyboard sections), `tunnel`, `space`, `blackout`, `ice`, `ascent`, `orbit`, `end`.
- `speed` is the story speed in metres per second, as keyframes. It places the ship along the route, so set pieces arrive on cue. What the rider *sees* is this multiplied by their effort; see "Story pace against rider effort" in `ARCHITECTURE.md`.
- `curves` are named keyframe tracks the kits read. The useful ones: `fov` (field of view in degrees; wide reads as fast), `shake`, `roll`, `yaw`, `climb`, `fade` (0 is black, 1 is clear), `flash`, `glitch`, `blur`, `glassFog` and `glassThaw` (the condensation).
- `impacts` shake and flash the screen and decay over about a second.
- `env` sets sky colours, fog, stars and the sun, blended between keys.
- `props` place set pieces (`warpRing`, `meteor`, `hangarChunk`, `steamColumn`, `downedShip`, `gate`), `markers` name moments the kits use, and `streaks` tune the speed streaks. These are the fiddliest part; copy from Chapter 1 and adjust.

Keyframes are `[time, value]` pairs in time order, joined by straight lines. For a hard cut, put two keys a hundredth of a second apart.

## Sound and music

```json
"sfx": [{ "t": 770, "id": "boom", "args": [1.3] }, { "t": 765, "id": "riser", "args": [5] }],
"music": {
  "bpm": 90,
  "sections": [{ "from": 660, "to": 771, "mode": "dark", "fast": true, "level": 1, "kick": 1, "hat": 1, "bass": 1, "arp": 1, "pad": 0.6, "bright": [[660, 0.5], [770, 1]] }],
  "ambience": { "drone": [[772, 0], [782, 0.12], [990, 0]] }
}
```

- Sounds: `boom` (size), `riser` (seconds), `whoosh`, `crack`, `chime` (pitch in Hz), `ping`, `alarm`, `glitch`, `boot`, `swell` (seconds, root pitch), `callTone`, `hissSeal`, `creak`, `tick`, `step`.
- Music sections pick a `mode` (`main`, `dark`, `tense`, `hope`) and set the level of each layer, as a number or as keyframes. `party` and `fast` change the drum pattern.
- `ambience` curves drive the continuous layers: `engine`, `drone`, `ring`, `hiss`, `rumble`, the wind controls and the music filter. `loops` plays a clip on repeat at the level of the ambience curve with the same name.

## Challenges: reacting to the rider

A challenge watches the rider for a window of time and branches on the result:

```json
"challenges": [{
  "id": "clamp", "from": 60, "to": 120,
  "prompt": "Hold 95 to 105% of FTP for 20 seconds to lock the clamp",
  "condition": { "metric": "powerFtp", "min": 0.95, "max": 1.05, "hold": 20, "grace": 2 },
  "onSuccess": {
    "setFlags": { "clampLocked": true },
    "hud": [{ "type": "notice", "t": 0, "hold": 6, "kind": "info", "text": "CLAMP LOCKED" }],
    "sfx": [{ "t": 0, "id": "chime", "args": [990] }]
  },
  "onFail": { "setFlags": { "clampLocked": false } }
}]
```

- `metric`: `power` (watts), `powerFtp` (fraction of FTP), `powerTarget` (fraction of the current workout target), `cadence`, `heartRate`, `heartRateMax` (fraction of max).
- The rider must stay between `min` and `max` for `hold` seconds without a break. `grace` forgives short slips.
- It succeeds the moment the hold is met, and fails if the window closes first.
- Times inside a branch are measured **from the moment it resolves**, so `"t": 0` means "right then".
- `setFlags` sets story flags. Any dialogue line, glass line, HUD item, sound or later challenge can carry `"if": "clampLocked"` or `"unless": "clampLocked"` to appear only on one path.

Keep both paths the same length. The workout does not branch, so the chapter always ends on time.

## Notes to self

```json
"notes": [{ "t": 1230, "kind": "todo", "text": "Needs a line from Holt here" }]
```

The engine ignores `notes`. The ride-script converter puts everything it could not map here, so nothing from the script is lost.

## Voice clips and images

- Clips: MP3, in the folder named by `assets.clips`. The file name without `.mp3` is the clip id.
- Images: JPEG, in the folder named by `assets.images`, referred to without the extension.
- `npm run validate` reports any clip or image a chapter names that is not on disk.

## Checklist before you call it done

- `npm run validate` passes.
- The workout total matches `duration`.
- You have ridden it once start to finish with the simulated rider, and scrubbed back through the busy parts.
- Every challenge has been tried both ways: on the ride's control bar, the Effort slider and **Stop pedalling** let you fail on purpose.
