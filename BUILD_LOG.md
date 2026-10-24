# Build log

Evidence of how we built TwinCare, for the Anthropic ("Claude in development") and SpaceXAI/MLH ("built with Cursor, Grok Bot") tracks. Add a timestamped entry and a screenshot for each work session.

## Fri Oct 23

**~8:30 PM PT — Scaffold and backend (Cursor agent, Claude model)**
- Generated the project from the SpacetimeDB `react-ts` template; used the template's `AGENTS.md` / `.cursor/rules` so the Cursor agent wrote against the current SpacetimeDB 2.13 TypeScript API.
- SpacetimeDB module: 11 tables, 16 reducers, a 2-second scheduled simulator for the Twin Pod, deterministic red-flag rules, and a scheduled procedure that calls Claude for the SBAR draft (API key stored as a module environment value).
- Verified from the CLI: a calf-pain check-in on the surgical side opened a same-day blood clot alert, drafted an SBAR, and wrote three audit events.

**~9:30 PM PT — Frontend**
- Procedural reference body with skin, muscle, and skeleton layers plus a knee implant on the surgical side; tap maps to a body region (e.g. "Right calf (front)").
- Patient check-in sheet (OPQRST), with an immediate "Call 911" path for chest pain or shortness of breath.
- Nurse dashboard: priority-sorted census, mirrored live twin with the patient's pointer, alert actions, SBAR approval, audit trail, live impact metrics.
- Tested end to end in two browser tabs: patient check-in appeared on the nurse's twin live; acknowledge + approve updated the patient's banner live.

Screenshots: _add here_

**~10:15 PM PT — Interaction research with REA, then twin UX pass**
- Used [REA](https://github.com/morluto/rea) (`rea-agents` 6.7.0) through a throwaway Chrome profile to study the interaction design of neal.fun/about, our inspiration: `inspect-web-page` (DOM + accessibility tree), `analyze-web-bundle` (routes, endpoints, renderer hints), and `capture-web-screenshot` before and after toggling views. Only the patterns were studied; no code or assets were taken.
- What we learned: a two-level view model (Outside/Inside pill, then independent layer chips with color dots), glowing landmark hotspots that open a callout card with a leader line, a stats card where every live number shows a unit, a sparkline, and a "last updated" line, and a Draco-compressed GLB scan with a separate phone-sized model. The anatomy credit points to BodyParts3D.
- Built in TwinCare: an Outside/Inside mode with Muscles, Bones, and Implant chips; clinical hotspots (incision, knee bend, calf, breathing) that show plain-language guidance to patients and live readings plus the matching rule to nurses, colored by the same thresholds the server rules use; ambient particles; a "Last updated" line on the Twin Pod card.

## Sat Oct 24

**~12:30 AM PT — Real anatomy and photo twins**
- Replaced the procedural body with BodyParts3D meshes (skin, muscles, skeleton, arteries, veins). `scripts/build-anatomy.mjs` converts the OBJs to a single 2.2 MB GLB with gltf-transform (merge per layer, simplify, quantize, meshopt), and writes landmark positions (patella, femur, tibia, soleus, sternum) used to place the knee implant and snap hotspots onto the skin. Credit shown on the twin; the GLB keeps BodyParts3D's CC BY-SA 2.1 JP license.
- Outside view: reference body with a tank top and shorts, and the surgical leg tinted. Inside view: translucent skin over real muscles, bones, and an optional vessel layer, with an x-ray implant overlay (femoral component, insert, tibial tray).
- Tap-to-region now works on the real skin (nearest body region to the tapped point); verified "Right calf (front)".
- Photo twin: the patient uploads a full-body photo; a `requestTwin` reducer queues a scheduled procedure that sends it to fal's image-to-3D model (TRELLIS by default), polls until done, and saves the GLB URL on the patient. The fal key is a server-side module environment value. Without a key the patient sees a clear "not configured" message (verified). The viewer normalizes any GLB to standing height and keeps the hotspots and tap-to-region working on it (verified with a test GLB).

## Sat Oct 24

**~11:45 AM PT — Rename, GitHub, and full UI redesign**
- Renamed the project to **Digital Twin Biomedical** and pushed the repo to github.com/isaksmith/DigitalTwinBiomedical (history scanned for leaked keys first — none).
- Completely rebuilt the UI with an Evangelion-inspired minimal glass look: dark stage, orange HUD lines, ultra-condensed serif title cards (Noto Serif Display), hexagonal status lights, red hazard stripes reserved for real emergencies. Body/UI set in Google Sans Flex with Google Sans Code for readouts.
- Nurse alert cards now show a three-unit safety readout (Rules → Claude → Nurse), modeled on the show's MAGI system.
- 3D scene restyled: orange/cyan rim lights, floor grid with rotating range rings, billboarded hexagon hotspot markers with sensor-ping pulses, and a fresnel "glass skin" shader for the Inside view.
- Outside view source tiers: personal Meshy scan → Meshy reference exterior → anatomy skin, with a safe GLTF loader that falls back instead of crashing the render loop (found and fixed two uncaught-error bugs that silently killed rendering).
- Verified in the browser at 1512px and ~1024px: landing, patient Outside/Inside/knee views, tap-to-region check-in sheet, and the nurse console. All 41 tests, both type checks, and the production build pass.

**~12:00 PM PT — Light theme pass**
- Switched to a light UI on feedback: white background with a faint warm grid, semi-transparent white glass cards, dark ink text, and the same orange accent system (tones darkened for contrast on white).
- Set Google Sans as the single UI face (dropped the artificial condensation and mono styling on labels; Google Sans Code stays for numeric readouts and the audit trail).
- Removed the live/offline dashboard indicator.

**~4:30 PM PT — Photo twin works end to end (with a real photo)**
- Published the module to SpacetimeDB Maincloud (`maincloud.spacetimedb.com`) after refreshing the CLI login; local server unchanged.
- Generated a real person's 3D twin from a full-body photo through Meshy's image-to-3D API. Three bugs found and fixed along the way:
  1. `new URL()` throws for every input inside the SpacetimeDB server sandbox, so the job always rejected the finished asset. Replaced with structural URL validation (https + `assets.meshy.ai` host + no credentials) that works in any runtime.
  2. The GLB may come back in `model_urls.glb` or `model_url` depending on the API version; the extractor now accepts both.
  3. Meshy's asset CDN sends no CORS headers, so the browser cannot load the GLB directly. Added a same-origin dev-server proxy (`/twin-proxy`, allowlisted to Meshy's asset host) and the viewer routes provider URLs through it. A production deployment needs the same proxy as an edge function.
- Verified in the browser: the photo twin renders on the patient view with hotspots anchored to it, credit "Personal scan · Meshy image-to-3D". The signed asset URL expires in 3 days; regenerate shortly before the demo or mirror the file locally.
- Set up git worktrees (`agents/cursor`, `agents/droid`, `agents/kadrian`) with branches and dependencies installed for parallel agent work.

**~5:00 PM PT — Broader patients and standard vitals**
- Demo patients now span knee replacement, heart failure, diabetic foot wound care, and COPD; every screen labels them from the stored condition.
- The Twin Pod reports the five standard vital signs (heart rate, blood pressure, respiratory rate, SpO₂, temperature) in a new `vital_sign` table, replacing knee bend, steps, and incision/calf skin temperature. Red-flag rules now cover low SpO₂, tachycardia, fever, tachypnea, and low or very high systolic pressure. Demo patterns: blood clot, infection, fluid overload.
- Hardened the dev-server asset proxy so an aborted model download can no longer crash Vite.

## To log next

- [ ] Grok Bot planning thread (screenshot)
- [ ] First real Claude SBAR vs. template
- [ ] 20-case triage eval vs. nursing lead labels

- [ ] Grok Bot planning thread (screenshot)
- [ ] First real Claude SBAR vs. template
- [ ] 20-case triage eval vs. nursing lead labels
