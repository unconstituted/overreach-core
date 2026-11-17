# Testing with real hardware

Everything Bluetooth in this repository was written from the specifications and tested against simulated packets, because no trainer was available. This is the checklist for the first session with real kit. Expect to find things; note them at the bottom.

## Before you start

- Desktop Chrome or Edge. Web Bluetooth does not exist in Safari or Firefox.
- The page must be served from `localhost` or over HTTPS. `npm run dev` is fine.
- Close Zwift, the manufacturer's app and anything else that might be holding the trainer. A trainer talks to one app at a time over Bluetooth.
- macOS: allow Chrome to use Bluetooth in System Settings → Privacy & Security → Bluetooth.
- Have the trainer's own app to hand on a phone, to compare power readings afterwards (not at the same time).

## 1. The device test page

Open `http://localhost:5173/devices.html`. It shows live readings and lets you drive the trainer by hand, without a chapter in the way.

### Trainer (FTMS)

- [ ] **Bluetooth…** opens the browser's picker and the trainer is listed.
- [ ] After choosing it, the status reads "connected" and names the protocol as FTMS.
- [ ] Pedal: power and cadence appear within a couple of seconds and look sane against the trainer's own display.
- [ ] Stop pedalling: power falls to zero within a few seconds. It must not stick at the last value.
- [ ] Set an ERG target of 150 W. Resistance changes within about three seconds and power settles near 150 W at any cadence.
- [ ] Step it to 250 W and back. Each change takes effect.
- [ ] Turn ERG off. The trainer switches to a flat-road simulation: resistance eases, and power now depends on your cadence and gear.
- [ ] Turn ERG back on. The target is held again.
- [ ] Disconnect from the page. The trainer returns to its easy default.
- [ ] Open the browser console. There should be no errors, and no "control point" warnings repeating.

### Power meter only (Cycling Power Service)

If you have power-meter pedals or a crank, or a trainer that does not offer FTMS:

- [ ] It appears in the same picker and connects, with the protocol shown as Cycling Power.
- [ ] Power reads correctly.
- [ ] Cadence reads correctly, and drops to zero within about three seconds of stopping. (Cadence is worked out from crank revolution counts; this is the maths most likely to be subtly wrong.)
- [ ] The trainer controls are disabled, as there is nothing to control.

### Heart rate

- [ ] A chest strap connects and reads within a couple of beats of what a watch shows.
- [ ] A watch in "broadcast heart rate" mode connects the same way. (Garmin: Settings → Sensors → Wrist Heart Rate → Broadcast. Apple Watch needs a third-party app.)
- [ ] Take the strap off: the reading should stop or show no contact, not freeze.

### Reconnection

- [ ] With an ERG target set, unplug the trainer for ten seconds and plug it back in. The status should go to "reconnecting", then "connected", and the **same target should be restored without you touching anything**.
- [ ] Walk the heart-rate strap out of range and back. It should reconnect by itself.
- [ ] Turn Bluetooth off and on at the computer. Both should recover, or fail with a clear message.

## 2. A real ride

Open `http://localhost:5173/`, choose **Bluetooth…** for the trainer and heart rate on the start screen, enter your real FTP and max heart rate, and start Chapter 1.

- [ ] The power, cadence and heart-rate numbers on the visor follow you.
- [ ] In ERG steps, resistance follows the workout target at each step change.
- [ ] In the surges marked "ERG off", the trainer lets go: you can spin up freely, and the visor shows your power against the target.
- [ ] Coming out of a surge, ERG returns without a "wall" (a sudden lock at low cadence). If it does wall, note the trainer model; the fix is a short ramp when ERG resumes.
- [ ] Stop pedalling for ten seconds mid-ride: the speed read-out and streaks collapse, the engine sound drops, and the story carries on.
- [ ] The stroke-by-stroke feel layer (try **Feel: Aggressive**) lines up with your pedalling. If the strikes feel late, it is the trainer's data rate: most send power once a second, some four times. Note the model and what it felt like.
- [ ] The peak-hold hairline on the power rule breaks when you genuinely push harder than the last 30 seconds, and not otherwise.
- [ ] Pause (<kbd>Space</kbd>) and resume: the trainer keeps its target; recording pauses.
- [ ] At the end, the summary looks right against how the ride felt, and **Download .fit** saves a file.

## 3. The file

- [ ] Upload the `.fit` to **Garmin Connect** (Import Data on the web). It should appear as an indoor or virtual ride with power, cadence and heart rate, and one lap per workout step.
- [ ] Upload it to **Strava**. It should appear as a virtual ride. Check that the power curve, average power and the weighted average are close to the end screen's figures.
- [ ] If you use TrainingPeaks or intervals.icu, check normalised power and training stress there too. Small differences are normal (platforms smooth and round differently); large ones are a bug.
- [ ] Distance and speed should be plausible for a flat road at that power. The game's own speed is deliberately not written to the file.

If a platform rejects the file, run it through Garmin's FIT SDK tools (`FitCSVTool`) and note the first error. The usual causes are a missing or mis-ordered message, which is a small fix in `src/core/record/fitActivity.ts`.

## 4. Treadmills and footpods

**Safety first.** Keep the safety key clipped on and the stop button within reach. The game should never restart a belt you have stopped; if it ever does, stop testing and report it as the first finding. Start with the top-speed setting (Settings → Devices) a little above your threshold pace.

On the device test page, or on the screen before a session, choose **Run**.

### Treadmill (FTMS)

- [ ] **Bluetooth…** on the Treadmill row lists the treadmill, and it connects as "FTMS treadmill (controllable)" or "(read-only)".
- [ ] Walk or jog: the speed shown matches the treadmill's own display, within 0.1 km/h.
- [ ] Incline: change it on the treadmill; the reading follows.
- [ ] Start a run with **Treadmill control** on. The belt starts by itself at the first target, gently, and changes speed at each step. Note how long each change takes.
- [ ] Press the treadmill's own **stop**: the run pauses, the visor says "Belt stopped", and **the belt stays still** however long you wait. Press play in the game: it starts again.
- [ ] Pull the **safety key**: the same.
- [ ] Pause in the game: the belt stops. Play: it starts again.
- [ ] Turn **Treadmill control** off in Settings: the game no longer changes the speed; the visor shows "You set the belt" and the target pace.
- [ ] A free run on a map: the incline follows the hills (uphill only) at the "trainer difficulty" setting.
- [ ] End the run: the belt stops and the treadmill is released.
- [ ] Drop the connection (turn the treadmill's Bluetooth off, or walk the laptop away) mid-run: it reconnects, restores the speed, and does not start a belt that was stopped.

Many treadmills only accept control while their own app is closed, and some need a button pressed on the console first. Note the model and what was needed.

### Footpod (Running Speed and Cadence)

- [ ] **Bluetooth…** on the Footpod row lists the pod.
- [ ] Cadence reads around 160 to 185 when running. If it reads around 80 to 95, the pod sends strides rather than steps and the doubling rule in `src/devices/protocol/rsc.ts` missed it.
- [ ] With **no treadmill** (choose None on the Treadmill row), speed comes from the pod. Compare it with the treadmill display: footpods often need calibrating.
- [ ] A Stryd or similar pod connects "with running power", and the post-run screen shows average running power.

### The run file

- [ ] Upload the `.fit` to Garmin Connect and Strava. It should appear as a treadmill (or indoor) run with distance, pace, heart rate and cadence (Strava doubles the stored strides to show steps).

## Things worth knowing when it goes wrong

- **Nothing in the picker.** Wake the trainer by pedalling. Check nothing else is connected to it. Some trainers only advertise FTMS when their ANT+ FE-C channel is idle.
- **Connects, but no control.** The trainer has not granted control. The engine asks again automatically after a "control not permitted" response; if it loops, capture the console output.
- **Power reads double or half.** Some power meters report one leg and flag it; check the Cycling Power "pedal power balance" handling in `src/devices/protocol/cps.ts`.
- **Cadence spikes.** Look at the crank revolution roll-over handling (the counters are 16-bit and wrap) in the same file.
- **To capture packets**, open `chrome://bluetooth-internals` in another tab, or enable Chrome's Bluetooth logging. Byte dumps of anything odd make excellent new test fixtures: add them under `test/devices/`.

## Findings

Record the date, the trainer and sensor models, the browser version, and anything that did not behave as this page says.

| Date | Kit | Browser | What happened |
| --- | --- | --- | --- |
| | | | |
