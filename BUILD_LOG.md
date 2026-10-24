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

## To log next
- [ ] Grok Bot planning thread (screenshot)
- [ ] First real Claude SBAR vs. template
- [ ] 20-case triage eval vs. nursing lead labels
