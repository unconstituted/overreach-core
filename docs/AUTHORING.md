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
- For running, use `pace`, a fraction of the runner's threshold pace as a speed (`1.0` is threshold, `1.05` is 5% faster, `0.8` is easy), or `secPerKm` for an absolute pace (`300` is 5:00 per km).
- For heart rate, use `hr`, a fraction of maximum heart rate (`0.72`), or `bpm`. A heart-rate step cannot be held by a trainer or treadmill; the player rides or runs it to feel.
- A `ramp`'s `from` and `to` are fractions of FTP, or of threshold pace in a running workout. Give `"unit": "hr"` (or `watts`, `speed`, `bpm`) to say otherwise.
- `cadence` (rpm) is optional.
- `"erg": false` hands resistance back to the rider for that step. Use it for surges, where ERG mode feels like hitting a wall.
- `label` is what the rider sees. Keep it short.
- The engine adds a "spin up" countdown (for a runner, "pick it up") five seconds before any step at 100% of FTP or threshold pace or more. You do not write those.
- You do not need to write a running version of a chapter. Any power-based workout can be run: the player chooses **Run** before the session, and every power target becomes a pace at the same effort (50% of FTP is 80% of threshold pace, FTP is threshold pace, 120% is 108%). Write pace targets only for a session that is meant to be run.

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
- For a runner, `power`, `powerFtp` and `powerTarget` are judged on effort: holding threshold pace counts as 100% of FTP, and holding the target pace counts as 100% of the target. So `powerFtp` and `powerTarget` challenges work for both sports without change. `powerTarget` is the safest choice. `cadence` is steps per minute for a runner (170 or so), so a pedalling challenge such as "above 90 rpm" is no challenge on foot: prefer an effort condition, or give the runner a different prompt.
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

# Other content: workouts, plans, maps and seasons

Everything else the game ships with lives in `content/`, one JSON file per item. As with chapters, adding one never needs a code change: drop the file in, and it appears in the menus. `npm run validate` checks every file and every reference between them; `npm run dev` rebuilds the catalogue as you save.

Ids are lower-case letters, digits and hyphens. The file name should match the id.

## Workouts (`content/workouts/<id>.workout.json`)

```json
{
  "$schema": "../../schemas/workout.schema.json",
  "format": 1,
  "id": "burn-windows",
  "title": "Burn Windows",
  "description": "Five three-minute burns at VO2 max. Each window is short. Use all of it.",
  "sport": "bike",
  "focus": "vo2",
  "difficulty": 4,
  "tags": ["vo2 max"],
  "steps": [
    { "kind": "ramp", "duration": 600, "from": 0.45, "to": 0.75, "label": "Systems warm", "intensity": "warmup" },
    { "kind": "intervals", "repeat": 5, "on": { "duration": 180, "power": 1.15, "label": "Burn window" }, "off": { "duration": 180, "power": 0.5, "label": "Coast" }, "erg": false },
    { "kind": "ramp", "duration": 420, "from": 0.6, "to": 0.4, "label": "Power down", "intensity": "cooldown" }
  ]
}
```

- `steps` are exactly the steps described under "Workout" above.
- To use a Zwift or Garmin file instead, put it beside the JSON and write `"file": "storm-front.zwo"` in place of `steps`. Its text events show on the visor.
- `focus` is one of `recovery`, `endurance`, `tempo`, `sweetspot`, `threshold`, `vo2`, `anaerobic`, `sprint`, `mixed`, `test`. `difficulty` is 1 to 5. Both are for the library's filters.
- `sport` is `bike` (the default) or `run`. A running workout uses `pace`, `secPerKm`, `hr` or `bpm` targets, and can only be run. A cycling workout can be ridden or run (see above).
- Duration, intensity, training stress and whether it counts as a hard day are worked out for you from the steps. Runs are scored by effort, so an hour at threshold pace scores like an hour at FTP.
- Zwift run files (`<sportType>run</sportType>`) work as they are: their `Power` values are read as fractions of threshold pace, as Zwift means them.
- A plain workout is ridden in open space, with the ship's speed following the targets. Step text (`texts`) appears in the centre of the visor under "CONTROL", so use it for coaching lines.

## Plans (`content/plans/<id>.plan.json`)

```json
{
  "$schema": "../../schemas/plan.schema.json",
  "format": 1,
  "id": "shakedown-week",
  "title": "Shakedown Week",
  "description": "Three rides in seven days to learn the controls.",
  "sport": "bike",
  "level": "beginner",
  "goal": "Try the game and a training week",
  "hoursPerWeek": [2, 2.5],
  "style": "calendar",
  "weeks": [
    {
      "title": "Shakedown", "focus": "Find your feet",
      "days": [
        { "day": 1, "sessions": [{ "ref": "workout:dock-spin", "note": "If this is not easy, lower your FTP." }] },
        { "day": 3, "sessions": [{ "ref": "workout:long-haul", "alternatives": ["workout:dock-spin"] }] },
        { "day": 6, "sessions": [{ "ref": "chapter:ch1" }] }
      ]
    }
  ]
}
```

- A session points at `workout:<id>` or `chapter:<id>`. A reference to something that does not exist fails validation.
- `day` is the day of the plan week, 1 to 7. **Day 1 is the day the player starts**, not Monday. Leave rest days out.
- `"optional": true` marks a session the plan can live without: if missed it is dropped, never rescheduled.
- `alternatives` are swaps the player may pick on the day (a shorter or easier version).
- `style` is `calendar` for a training block or `story` for a plan built round a season's chapters (name it with `"season": "season-1"`). The two work the same; the label tells the player what they are getting.
- `level` is `beginner`, `intermediate` or `advanced`; `hoursPerWeek` is `[low, high]`.
- `sport` is `bike` or `run`. A running plan may include cycling workouts and chapters: they are run at the same effort. A cycling plan may not include a running workout, and the validator says so. `ground-crew` is a running plan whose last week runs Chapter 1 on foot.

What the engine does with it, so you can design for it: a missed session is pushed to the next free day of the same week, unless that would put two hard days back to back, in which case it is dropped (players can choose "skip" instead in Settings). So do not put hard sessions on consecutive days, and give the player an easy alternative on the hardest days.

## Maps (`content/maps/<id>.map.json`)

```json
{
  "$schema": "../../schemas/map.schema.json",
  "format": 1,
  "id": "terror-flats",
  "title": "Terror Flats",
  "description": "Low over the ice plains of Terror.",
  "use": ["freeRide"],
  "length": 15000,
  "profile": [[0, 0], [2000, 0.5], [3000, 3], [3800, 4.5], [4200, -2], [15000, 0]],
  "image": "ch1/images/s09.jpg",
  "scene": { "id": "ice", "speedScale": 14, "fov": [72, 100], "env": { }, "streaks": { } },
  "unlock": { "type": "chapterCompleted", "chapter": "ch1" }
}
```

- `length` is metres of road; `profile` is `[distance in metres, grade in percent]` keys. The trainer feels the grade (scaled by the player's "trainer difficulty" setting), and the rider's power moves the ship through a bike model. Keep grades within ±25%.
- `scene.id` is a scene kit. `speedScale` is how many metres of scenery pass per metre of road: open space needs a big number (40 to 60) to feel like anything; low over ice, 12 to 15.
- `scene.env` and `scene.streaks` set the look. Copy them from a chapter moment you like (the `scene.env` and `scene.streaks` entries in `ch1.chapter.json`).
- `image` is a preview, relative to the site root (chapter images live under `ch1/images/...`).

## Seasons (`content/seasons/<id>.season.json`)

```json
{
  "$schema": "../../schemas/season.schema.json",
  "format": 1,
  "id": "season-1",
  "title": "The Dark Segment",
  "number": 1,
  "description": "A routine race day ends with the station gone and one pilot down on the ice.",
  "chapters": [{ "id": "ch1" }, { "id": "ch2" }],
  "flags": ["clampLocked"]
}
```

- Chapters unlock in order: the first is open, each of the rest opens when the one before it is completed. Give a chapter its own `unlock` to override that.
- Story flags set by a chapter's challenges are kept per season and handed to the next chapter, so `"if": "clampLocked"` in Chapter 3 can react to what happened in Chapter 2. List the flags the season uses in `flags`, for the record.

## Unlock rules

Plans, maps, seasons and chapters (through their season) can carry an `unlock`. It is one of:

| Rule | Opens when |
| --- | --- |
| `{ "type": "always" }` | From the start (the same as leaving `unlock` out) |
| `{ "type": "chapterCompleted", "chapter": "ch1" }` | That chapter has been ridden to the end |
| `{ "type": "flag", "season": "season-1", "flag": "clampLocked" }` | A story flag is set (add `"value": false` for "is not set") |
| `{ "type": "totalDistance", "km": 50 }` | The player has ridden that far in total |
| `{ "type": "totalTime", "hours": 10 }` | The player has ridden that long in total |
| `{ "type": "planWeek", "week": 3, "plan": "base-builder" }` | The player has reached that week of a plan (leave `plan` out for any plan) |
| `{ "type": "all", "rules": [ ... ] }` | Every rule inside is met |
| `{ "type": "any", "rules": [ ... ] }` | At least one is met |

Once something unlocks it stays unlocked. The player is told what unlocked on the screen after the ride, and locked items show how to open them.

## Checklist before you call it done

- `npm run validate` passes (it covers chapters and everything in `content/`).
- The workout total matches `duration`.
- You have ridden it once start to finish with the simulated rider, and scrubbed back through the busy parts.
- Every challenge has been tried both ways: on the ride's control bar, the Effort slider and **Stop pedalling** let you fail on purpose.
