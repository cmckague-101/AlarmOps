# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Wildland fire contractors. Company owners manage fleet and crew readiness. Crew members use assigned equipment and report operational issues. Both roles need incident visibility.

## Product purpose

FireOps helps contractors manage vehicles, crew records, readiness, and active wildfire operations in one workspace. Success means teams can see what is deployable, what needs attention, and where resources are working.

## Positioning

FireOps connects contractor fleet and crew records to wildfire operations instead of treating equipment inventory as a standalone administrative task.

## Operating context

Users work from offices and field environments. Workflows include vehicle readiness, issue tracking, crew credentials, equipment assignment, and reviewing active NIFC wildfire incidents.

## Capabilities and constraints

- Owners manage fleet records, crew access, credentials, assignments, company documents, and integrations.
- Crew members can review assigned resources, view company documents, and report issues.
- Company documents notify crew until each new or updated file is viewed.
- Owners schedule company training and review attendee rosters. Crew receive new-course notifications and can register up to course capacity.
- Owners manage company inventory item names and quantities. Inventory is hidden from crew members.
- Operations is available to owners and crew.
- Operations uses current NIFC incident data. Missing incident values display as "Not reported."
- Operations defaults to incidents with company vehicle assignments and can show all active incidents.
- Owners assign crewed vehicles to active NIFC fires from vehicle details. Fire assignments appear in Fleet and Operations.
- Supabase provides authentication and company data. Demo mode uses browser storage.

## Brand commitments

Product name is FireOps, powered by Fireco. Existing FireOps logos, direct operational voice, and established interface identity remain fixed.

## Evidence on hand

- Brand assets in `public/`.
- Existing fleet, crew, issue, and Motive integration workflows in `src/App.tsx`.
- Current wildfire incident data comes from NIFC's public WFIGS ArcGIS service.
- No customer claims, benchmarks, or assignment data should be fabricated.

## Product principles

- Put deployment status and next action ahead of administration.
- Keep critical facts visible at mobile and desktop sizes.
- Distinguish reported source data from company-managed data.
- Handle missing or delayed external data without guessing.
- Keep owner and crew permissions explicit.

## Accessibility & inclusion

Preserve keyboard access, visible focus, text labels alongside color, reduced-motion support, responsive layouts, and 44px touch targets on coarse pointers.
