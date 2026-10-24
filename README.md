# TwinCare

A live 3D twin for knee-replacement recovery at home. Patients tap (or talk) to report symptoms on their twin; their follow-up nurse sees it instantly on a live dashboard, with deterministic red-flag rules and a Claude-drafted SBAR handoff to approve.

Cal Hacks 13.0 · Spacetime · Anthropic "Claude for Public Benefit" · built in Cursor. Full design: `../DESIGN_SPEC.md`.

## Run locally

Prerequisites: Node 22+, [SpacetimeDB CLI](https://spacetimedb.com/install) 2.13+.

```bash
# 1. Local SpacetimeDB (port 3000 is often taken, so we use 3100)
spacetime start --listen-addr 127.0.0.1:3100
spacetime server add twinlocal --url http://127.0.0.1:3100 --no-fingerprint   # once

# 2. Publish the module (seeds 5 demo patients and starts the simulated Twin Pod)
npm install && (cd spacetimedb && npm install)
spacetime publish twincare --server twinlocal --module-path spacetimedb --yes

# Optional: real Claude drafts instead of template drafts, and photo-to-3D twins via fal
ANTHROPIC_API_KEY=sk-ant-... FAL_KEY=... spacetime publish twincare --server twinlocal --module-path spacetimedb --yes

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
| Claude call (scheduled procedure, key never reaches the browser) | `runSbarJob` in `spacetimedb/src/index.ts` |
| 3D twin: layers, implant, tap-to-region | `src/twin/` |
| Photo twin (fal image-to-3D, scheduled procedure) | `requestTwin` / `runTwinJob` in `spacetimedb/src/index.ts`, `src/patient/TwinPhotoCard.tsx` |
| Patient check-in (OPQRST) | `src/patient/` |
| Nurse dashboard, SBAR approval, impact metrics | `src/nurse/` |

Safety model: fixed rules run first and set a priority floor; Claude can raise priority but never lower it and never sets "emergency"; every AI draft needs nurse approval; patients never see AI output.

## Demo controls

Nurse dashboard → "Demo controls": switch a patient's simulated pod to the blood clot, infection, or stalled range-of-motion pattern, or reset all demo data.

## Anatomy model

`public/models/anatomy.glb` (skin, muscles, bones, arteries, veins; 2.2 MB, meshopt-compressed) is built from BodyParts3D, (c) The Database Center for Life Science, licensed under [CC Attribution-Share Alike 2.1 Japan](http://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). The GLB is a derived work under the same license; the app shows the credit on the twin. To rebuild it, download `isa_BP3D_4.0_obj_99.zip` and `isa_element_parts.txt` from the BodyParts3D archive into `~/.cache/bp3d` (unzip into `isa/`), then run `npm run build:anatomy`. This also regenerates `src/twin/anatomy-landmarks.json`, which places the implant and snaps hotspots.

If the GLB fails to load, the twin falls back to the procedural body in `src/twin/bodyModel.ts`.

Prototype with fictional patients. Not a medical device.
