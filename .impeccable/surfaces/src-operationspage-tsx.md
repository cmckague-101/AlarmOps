---
version: 1
slug: "src-operationspage-tsx"
primary_target: "src/OperationsPage.tsx"
related_targets: ["src/App.tsx","src/styles.css"]
---

## Scope and mode

Operations section in `src/OperationsPage.tsx`. Operate mode.

## Audience and job

Company owners and crew review current wildfire incidents and identify incidents with company resources assigned.

## Task and content

Default to assigned incidents. A "Show all fires" toggle reveals active NIFC WFIGS wildfires and replaces the side ledger with selectable states. States sort by fire count by default, with an A–Z sort control. Selecting a state frames it on the map and replaces the state ledger with that state's fires, sorted by reported acres from largest to smallest. Selecting a fire frames its location and opens details with a state-level location map, acres, containment, personnel, discovery date, and latest NIFC update. Returning to the state list restores the nationwide map. Missing source values read "Not reported."

## Constraints

Inherit FireOps interface system and both themes. NIFC remains attributed as source. Do not imply NIFC data is real-time or complete. Resource assignment is planned and currently supplies no assigned incidents.

## Direction

Extend Field Command Ledger with a map-led workspace and adjacent incident ledger. Map is primary on desktop, then stacks above list on mobile. Ember marks active wildfires and wayfinding only.

## Unresolved

Vehicle and personnel assignment model, assigned-incident persistence, assignment controls, and incident search/filtering remain future work.
