---
version: 1
slug: "src-operationspage-tsx"
primary_target: "src/OperationsPage.tsx"
related_targets: ["src/App.tsx","src/styles.css"]
---

## Scope and mode

Operations section in `src/OperationsPage.tsx`, with vehicle assignment controls and resource data in `src/App.tsx`. Operate mode.

## Audience and job

Company owners assign crewed vehicles to active fires. Owners and crew review fires, assigned vehicles, crew, and available vehicle location data.

## Task and content

Owners open vehicle details, assign an active crew member, then search active NIFC fires by name and select one. Selection persists incident ID, name, and state on vehicle record. Fleet rows show fire name. Operations defaults to incidents referenced by vehicle assignments. Each assigned fire expands into a vehicle ledger with unit, type, year, make, model, plate, assigned crew, and Motive location, speed, and update time when available. Connected Motive accounts without a location snapshot show "Motive location unavailable." Fire details show assigned vehicles and a deduplicated crew roster. Selecting a vehicle opens vehicle details. "Show all fires" reveals active NIFC WFIGS wildfires and state browsing. Missing source values read "Not reported."

## Constraints

Inherit FireOps interface system and both themes. NIFC remains attributed as source. Do not imply NIFC or Motive data is real-time or complete. Fire assignment requires crew assignment. Clearing crew or moving vehicle out of Assigned status clears fire assignment. Owners manage fire assignments. Crew can view assigned resources. Motive snapshots match vehicles by exact normalized VIN; never guess a match.

## Direction

Extend Field Command Ledger with map-led workspace and adjacent incident and resource ledger. Map is primary on desktop, then stacks above list on mobile. Ember marks active wildfires and fire assignment wayfinding. Green marks available Motive telemetry. Resource rows stay compact and preserve unit, crew, and location scan order.

## Unresolved

Personnel-only incident assignments, historical incident retention, and server-side Motive location synchronization remain future work.
