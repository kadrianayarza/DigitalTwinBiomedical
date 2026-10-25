# Digital Twin Biomedical

A 3D digital twin platform for remote patient monitoring: patients track symptoms on their own body, early-detection rules and Claude watch the stream, and recovery outcomes are simulated against the patient's actual trend — while the care team follows along live. Launch scenario: knee-replacement (TKA) recovery at home; the twin, tap-to-report interaction, and nurse dashboard generalize to other conditions.

Cal Hacks 13.0 · Spacetime · Anthropic "Claude for Public Benefit" · built in Cursor. Full design: `../DESIGN_SPEC.md`.

## Run locally

Prerequisites: Node 22+, [SpacetimeDB CLI](https://spacetimedb.com/install) 2.13+.

```bash
# 1. Local SpacetimeDB (port 3000 is often taken, so we use 3100)
spacetime start --listen-addr 127.0.0.1:3100
spacetime server add twinlocal --url http://127.0.0.1:3100 --no-fingerprint   # once

# 2. Publish the module (seeds 6 demo patients with example check-ins and starts the simulated Twin Pod)
npm install && (cd spacetimedb && npm install)
spacetime publish twincare --server twinlocal --module-path spacetimedb --yes
# Databases published before the examples existed: fill in check-ins for patients that have none
spacetime call --server twinlocal twincare load_example_check_ins

# Optional: real Claude drafts, DeepSeek (Bitdeer) SBAR uncertainties, and photo-to-3D twins via Meshy.
# Supply these as server-side shell variables, never VITE_* variables.
ANTHROPIC_API_KEY=sk-ant-... BITDEER_API_KEY=... MESHY_API_KEY=... spacetime publish twincare --server twinlocal --module-path spacetimedb --yes

# Optional: the patient and nurse health agents read BITDEER_API_KEY from .env.local (dev server only).

# 3. Client
npm run dev
```

Open two windows (each role gets its own identity, so both can run in one browser):

- Patient: http://127.0.0.1:5173/?role=patient
- Nurse: http://127.0.0.1:5173/?role=nurse

After changing tables or reducers: `npm run spacetime:publish:local && npm run spacetime:generate`.

## How it works

| Piece | Where |
|---|---|
| Tables, reducers, simulated pod, red-flag rules | `spacetimedb/src/index.ts` |
| Clinical thresholds, triage prompt, Claude tool schema | `spacetimedb/src/clinical.ts` |
| Claude SBAR draft, then a DeepSeek review that lists its uncertainties (scheduled procedure, keys never reach the browser) | `runSbarJob` in `spacetimedb/src/index.ts` |
| Patient and nurse health agents (streamed DeepSeek via Bitdeer, separate system prompts) | `agentCore.ts`, `agentProxy.ts`, `src/agent/` |
| 3D twin: layers, implant, tap-to-region | `src/twin/` |
| Photo twin (Meshy image-to-3D, scheduled procedure) | `requestTwin` / `runTwinJob` in `spacetimedb/src/index.ts`, API client in `spacetimedb/src/meshy.ts`, `src/patient/TwinPhotoCard.tsx` |
| Patient check-in (OPQRST) | `src/patient/` |
| Nurse dashboard, SBAR approval, impact metrics | `src/nurse/` |

Safety model: fixed rules run first and set a priority floor; Claude can raise priority but never lower it and never sets "emergency"; every AI draft needs nurse approval; patients never see SBAR drafts or triage output. The patient health agent only sees that patient's own record, does not diagnose, and points to 911 for red flags.

## Meshy photo twins

Create an API key using [Meshy's API quickstart](https://docs.meshy.ai/en/api/quick-start), ensure the account has API credits, and publish with `MESHY_API_KEY` set in the shell. An existing server can receive a new key without a rebuild:

```bash
MESHY_API_KEY=... spacetime publish twincare --server twinlocal --env-only --yes
```

`MESHY_MODEL` optionally overrides the default `latest` standard model. Keys stay in the SpacetimeDB server environment and are never sent to browsers. `.env.local` is for Vite client settings, not Meshy credentials.

Patients consent to sending a photo to Meshy, then choose a full-body JPEG, PNG, or WebP. Digital Twin Biomedical downscales it before submitting. A private scheduled job posts to Meshy's [Image to 3D API](https://docs.meshy.ai/en/api/image-to-3d), requests a textured A-pose GLB, polls progress, and updates the twin in both views. Polling stops after about 15 minutes; failed and canceled tasks show an error. Transient polling failures retry, but billable generation submissions are never automatically replayed.

The pending photo is removed from the job after submission. Meshy controls its own retention and generated-asset expiry. Use non-sensitive demo photos. Generated shapes are approximate, and Inside mode always shows reference anatomy, not a medical reconstruction.

## Checks

```bash
npm test
npm run build
npx tsc --noEmit -p spacetimedb/tsconfig.json
```

The tests use mocked Meshy responses and do not upload photos or spend credits.

## Demo controls

Nurse dashboard → "Demo controls": switch a patient's simulated pod to the blood clot, infection, or fluid overload pattern, or reset all demo data. The pod reports the five standard vital signs: heart rate, blood pressure, respiratory rate, SpO₂, and temperature.

## Anatomy model

`public/models/anatomy.glb` (skin, muscles, bones, arteries, veins; 2.2 MB, meshopt-compressed) is built from BodyParts3D, (c) The Database Center for Life Science, licensed under [CC Attribution-Share Alike 2.1 Japan](http://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). The GLB is a derived work under the same license; the app shows the credit on the twin. To rebuild it, download `isa_BP3D_4.0_obj_99.zip` and `isa_element_parts.txt` from the BodyParts3D archive into `~/.cache/bp3d` (unzip into `isa/`), then run `npm run build:anatomy`. This also regenerates `src/twin/anatomy-landmarks.json`, which places the implant and snaps hotspots.

If the GLB fails to load, the twin falls back to the procedural body in `src/twin/bodyModel.ts`.

The Outside view is only the patient's personal scan. Patients without one, or whose scan is still loading or failed to load, see the Inside view.

Prototype with fictional patients. Not a medical device.
