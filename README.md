# Roadster Ramp Drop — Three.js stunt simulation

A real-time WebGL recreation of the ramp stunt from the Tesla Roadster reveal: the car climbs a
towering C-shaped ramp, leaves the overhanging lip upside down, barrel-rolls on cold-gas
thrusters, and cushions its landing with four downward retro jets in a cloud of smoke.

Reference footage: [Tesla's official Roadster reveal post on X](https://x.com/Tesla/status/2110913438293647789).

Unofficial fan project — not affiliated with Tesla. The car is an original procedural model.

## Run

No build step. Serve the folder over HTTP (ES modules need it) and open it in a browser:

```bash
python3 -m http.server 8765
```

Then visit http://localhost:8765. Three.js r170 loads from the jsDelivr CDN.

## What's in it

- **Deterministic stunt sim** — the whole run is integrated once at 240 Hz (ramp climb along the
  chord between the axles, ballistic flight, scripted roll, suicide-burn retro controller,
  suspension spring on touchdown), then sampled by time. Replays, slow motion and scrubbing are exact.
- **C-ramp** — built by integrating a smoothed curvature schedule to a 148° overhang, with red LED
  edges and a procedural steel truss tower.
- **Cold-gas jets** — additive plume shaders with turbulence and shock diamonds; the retro jets
  clip to the ground.
- **GPU smoke** — ~1,800 billboard puffs whose motion, growth, fade and lighting are evaluated in
  the vertex shader from sim time.
- **Director's cut** — live wide run, then slow-motion replays (overhead, low front, drone), then an
  aerial pass where the stadium lights come up in sequence.
- **Post** — ACES tone mapping, bloom (with an HDR clamp pass), grain, vignette, letterbox.

## Controls

| Key / button | Action |
| --- | --- |
| Director cut / camera buttons | Switch between the edit and 8 fixed rigs (incl. free orbit) |
| `Space` | Play / pause |
| `R` | Restart |
| `1`–`8`, `D` | Cameras / director cut |
| `←` `→` or drag the timeline | Scrub |
| `H` | Hide the interface |
| ● Rec | Record one full director cycle to a WebM |

## Layout

```
index.html        page shell, HUD, import map
style.css
src/main.js       renderer, loop, UI wiring
src/sim.js        stunt physics + sampling
src/ramp.js       ramp profile, mesh, truss
src/car.js        car model, wheels, thruster jets
src/smoke.js      GPU smoke emitter + shader
src/env.js        ground, X marking, LED strip, floods, stands, lights
src/cameras.js    camera rigs, director edit list, light show
src/post.js       post-processing chain
src/envmap.js     reflection probe
src/textures.js   procedural textures
src/util.js       math helpers
```

Tuning knobs: climb speed (`vCruise`, `vLip`) and retro ignition altitude (`fireAlt`) in
`src/sim.js`; shot list in `src/cameras.js`.
