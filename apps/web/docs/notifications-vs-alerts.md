# Notifications vs Alerts

Product rule for dashboard and inbox UX.

## Notifications

**Informational only.** Fire when something changed or is new in the app and **does not need a response**.

Examples:
- New communications / crew chat messages
- New fleets added
- Any other informational update

## Alerts and Needs Attention

**Action items.** Anything the user **has to respond to** or act on.

Examples:
- Open shop / repair work that needs handling
- Oil change due
- Qualification or credential issues requiring action

## Quick test

| Question | Bucket |
| --- | --- |
| Does the user need to do something? | Alerts / Needs Attention |
| Are they just being informed? | Notifications |

## What feeds the owner Needs Attention card

Built by `needsAttentionRows` in `@fireops/domain` (`packages/domain/src/command-attention.ts`) and shared by the web and mobile owner dashboards:

- Open (not Done) **Critical** and **High** shop jobs from `shop_jobs`, critical first. Fleet issues reach this list through the server sync that opens a shop job for each fleet issue.
- Vehicles whose **next oil change due** date is today or earlier.
- Crew **RT-130 / work capacity test** records from 11 months after completion until renewed.
- Crew **credentials** that expired or expire within a month.

Rows are derived live from those records, so they clear when the job is closed, the oil change is logged or the record is renewed.
