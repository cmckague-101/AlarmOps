---
version: 1
slug: "src-inventorypage-tsx"
primary_target: "src/InventoryPage.tsx"
related_targets: ["src/App.tsx","src/FleetApp.tsx","src/styles.css"]
---

## Scope and mode

Owner-only Inventory section in `src/InventoryPage.tsx`, with navigation and data wiring in `src/App.tsx` and Supabase persistence in `src/FleetApp.tsx`. Operate mode.

## Audience and job

Company owners add company supply or equipment items, keep each quantity current, search the list, and remove obsolete items.

## Task and content

Inventory appears directly after Training in owner navigation and inside More on mobile. Each row shows item name, last update time, direct quantity input, decrement and increment controls, and delete action. New items require name and nonnegative whole-number quantity. Empty and no-search-results states keep next action clear.

## Constraints

Crew members cannot see Inventory in navigation or query inventory rows. Supabase RLS and mutation policies require company owner or scoped system administrator access. Quantities range from 0 to 999,999. Inherit FireOps Field Command Ledger, both themes, keyboard focus, and 44px coarse-pointer targets.

## Direction

Compact stock ledger. Item identity stays left, count adjustment stays in one fixed control path, destructive action remains separate.

## Unresolved

Categories, reorder thresholds, units of measure, adjustment history, and bulk import remain future work.
