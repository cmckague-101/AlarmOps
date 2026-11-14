# Client sandbox → live parity list

Compared on 2026-11-14:
- **Sandbox:** `origin/client-sandbox` @ `76a7c2b`, run locally on :5175 with `VITE_SANDBOX_MODE=true`
- **Live:** https://fireco.vercel.app in "Explore demo" mode (deployed from `origin/main` @ `241d359`)

Desktop web was compared page by page at 1280px, in demo mode on both. Mobile comes from the
code diff of `apps/mobile` on both branches (not run on a device). **Every web item below also needs
its mobile counterpart** (AGENTS.md: web + mobile together).

## Read this first: why ports "don't come over correctly"

1. **`main` has moved past the sandbox in many areas.** The sandbox branched from `09983cc`.
   Since then `main` gained 40 commits that re-implemented several sandbox ideas properly: Shop board
   (#13), Needs Attention (#14), System/Light/Dark theme (#15), Resource Boss (#16), multi-receipt upload
   (#17), nav reshuffle and More (#18, #19), tile accents and Outfit titles (#20), Send to VIPR (#21),
   invoice autofill (#23/#24), Assistant (#25, #28, #33–35), QuickBooks (#29), VIPR Intelligence (#30),
   and combined Dashboard + Operations (#32).
   Much of that logic lives in `packages/domain` on `main`. The sandbox keeps older copies in
   `apps/web/src` / `apps/mobile/src/lib`. **Copying a sandbox file over its `main` version
   rolls these features back.** Port the visual change (markup and CSS) into the `main` file instead.
2. **`styles.css` is one minified line per rule block.** File-level diffs are useless (300 KB). Port
   CSS selector by selector.
3. **Many visible differences are demo data, not UI.** The sandbox seeds Shop jobs, receipts, alerts
   and tasks into session stores. Live demo mode doesn't, so its Shop and Alerts look empty
   ("Shop jobs … aren't available in the demo"). The layout is the same.

Legend: ✅ live already matches or is better, keep live · 🎨 UI change worth porting · 🧩 new feature,
add a placeholder · ⚖️ decision needed (the two designs conflict)

---

## 1. App shell and navigation

| # | Area | Sandbox | Live | Action |
|---|------|---------|------|--------|
| 1.1 | Sidebar order | Operations, Travel, Comms, **News Feed**, Fleet, Roster, Quals, Docs, Receipts, Invoices, Payroll, Availability, Training, **Tools**, Settings | Operations, **VIPR Intelligence**, Travel, Comms, Fleet, **Shop**, Roster, Quals, Docs, Receipts, Invoices, (Payroll, Availability, Training, Audit log fit by height), **More**, Settings | ⚖️ Live fits the sidebar to the window height (#19). Recommend keeping live's behavior and only adding the News Feed entry (see 🧩 News Feed). |
| 1.2 | Overflow page label | Sidebar says "Tools", page h1 "Tools" | Sidebar says "More", page h1 "Tools" | 🎨 Rename the sidebar item to "Tools" if you want the sandbox wording (one-line label change). |
| 1.3 | Tools/More grid | Fixed 12 tiles: Receipts, Meetings, Travel, Roster, Qualifications, Documents, Training, Inventory, Failed Inspections, Workforce (soon), Marketplace, Settings | Overflow-only tiles: Payroll, Availability, Training, Audit log, Inventory, Failed Inspections, Workforce (soon), Marketplace (soon) | ✅ Same tile style. Add a **Meetings** tile as a "Coming soon" placeholder 🧩. Marketplace already has a placeholder. |
| 1.4 | Page titles | Mixed: Outfit 40/750 on Fleet, Comms, News, Training, Tools; **Manrope 32/800** on Travel, Roster, Quals, Docs, Receipts, Invoices, Payroll, Availability, Settings, Shop; DM Sans 42 on Command Center | Outfit 40/750 gray on **every** page | ✅ Live is consistent; don't port. Any "the titles look different" impression comes from the sandbox's mixed fonts. |
| 1.5 | Floating assistant mascot | Always shown, bottom right | Hidden in demo; shown when company setting `assistantEnabled` is on | ✅ Already on `main` (#25/#28). Demo-only difference. |
| 1.6 | Demo banner | None (removed in sandbox #2) | "Demo mode … See Pricing" banner + Exit demo | ✅ Keep live (sales funnel). |

## 2. Operations / Command Center

| # | Area | Sandbox | Live | Action |
|---|------|---------|------|--------|
| 2.1 | Greeting | Bordered card with red left rail: "Good Afternoon, / **Ryan!**" | Text line above the title (`main` 56bd9e1); **hidden in demo mode** | ⚖️ Pick one. The sandbox card is a small CSS port on `.command-greeting` (web) and `owner-dashboard.tsx` (mobile). Note that live hides the greeting in demo, so it won't show there either way. |
| 2.2 | Section order | Greeting → title → 4 cards → Alerts → Quick Actions → map → Notifications → Customize | Title → map + **Fleet locations** → Alerts → 4 cards → Quick Actions → National Fire Activity → Customize Operations | ⚖️ Live's order comes from #32 (Dashboard + Operations merge). Recommend keeping live's map-first order. |
| 2.3 | Command card colors | Rails and links: Incidents red, Personnel green, **Resources black**, **Needs Attention yellow** (#f5c518-ish) | Resources **blue** link, Needs Attention **brown** | 🎨 Colors only. Port the sandbox palette if you prefer it, in the `.command-*` card tokens (web) and the mobile tile accents. |
| 2.4 | Alerts list | Each row has a swipe/"Clear" action and "View more alerts…" | Alerts section exists; rows have no Clear | 🎨 Port "Clear" on alert rows (`SwipeToClear.tsx`, `dismissedNotifications`). `main` already has clearable notifications (#3), so reuse that store. |
| 2.5 | Quick Action tiles | **Square tiles 468×468** on desktop (aspect-ratio rule built for phone) | Compact tiles with a bottom accent rail | ✅ Keep live. The sandbox desktop tiles are a layout bug. |
| 2.6 | Dashboard notifications panel | "Notifications — Company updates shared with you", Clear all / Clear per row | Not on the dashboard (bell/inbox elsewhere) | ⚖️ Decide whether the dashboard panel comes back. If it does, it's UI-only on top of the existing inbox. |
| 2.7 | Incident map | Static fictional image ("Live map disabled") | Live NIFC MapLibre map + Fleet locations strip | ✅ Sandbox limitation; keep live. |
| 2.8 | National Fire Activity / GACC | Moved to **News Feed** page | On the dashboard | ⚖️ Depends on whether News Feed ships (see 🧩). |
| 2.9 | Customize button | "Customize Dashboard" | "Customize Operations" | ✅ Keep live wording (matches the #32 merge). |

## 3. Fleet

| # | Area | Sandbox | Live | Action |
|---|------|---------|------|--------|
| 3.1 | Header | "Fleet" + Add vehicle | "Fleet – **0 Issues**" (link) + **Send to VIPR** + Add vehicle | ⚖️ Sandbox is simpler. Recommend keeping Send to VIPR (shipped #21). |
| 3.2 | Summary tiles | None | Total / Ready / Needs attention tiles | ⚖️ Remove only if you want the sandbox's leaner look. |
| 3.3 | Vehicle rows | Larger 76px thumbnail, **mileage** (38,240 mi), **"N open issues"** count, inline **"Needs attention · Oil change due"** chip | Smaller thumbnail, no mileage, no issue count; oil chip only in Service section | 🎨 **Port.** Data already exists on `main` (oil change #10, issues). Web `FleetStatus.tsx` row markup; mobile `(tabs)/fleet.tsx` (sandbox already has the mobile version, but reuse `nextOilChangeWarning` from `@fireops/domain`, not sandbox `vehicle-oil.ts`). |
| 3.4 | "Current issues" section | Removed | Shown under list | ⚖️ Goes with 3.3. The per-row issue count replaces it. |
| 3.5 | Out-of-service thumbnail | Wrench icon instead of the photo | Vehicle photo | ✅ Keep live. |

## 4. Shop

| # | Area | Sandbox | Live | Action |
|---|------|---------|------|--------|
| 4.1 | Board layout | Critical tasks, General shop, then one row per vehicle with photo, "N tasks to complete" and the first job + "+1 more" | Same cards; no vehicle rows in demo | ✅ Same UI. Difference = demo seed data. Optional: seed demo shop jobs so the demo isn't empty. |
| 4.2 | Nav placement | Reached from Quick Actions only | In sidebar | ✅ Keep live. |
| 4.3 | Per-vehicle repair history screen (mobile) | `shop/repairs/[vehicleId].tsx` + PDF export | `main` has `shop/unit/[id].tsx` + `shop-repair-history` in domain | ✅ Already covered on `main`; don't port the sandbox file. |

## 5. Other shared pages

| Page | Difference | Action |
|------|-----------|--------|
| Receipts | Sandbox copy: "Capture receipts / Fire Ops Assistant prepares digital imports", "Add more", "Submit receipts"; full-width Project field. Live: "Add receipts", "Add files", "Up to 25 per batch", plus a **Search** field. Seeded rows show Open/Download ZIP/Edit/Delete. | ✅ Live is ahead (#17). 🎨 Optional copy tweaks only. |
| Travel | Sandbox h1 "**Travel Assistant**"; adds a **Restaurants** card (search by city/address, Overpass/OSM) | 🧩 Restaurants search = new feature (live only links out per hotel). Title rename is 🎨. |
| Comms | Sandbox adds a "**Marketplace conversations**" section | 🧩 Belongs with Marketplace. |
| Training | Sandbox: gamified **profile (LV, XP, PTS, Redeem XP)**, **Modules** with track chips (FFT2/FFT1/ENGB/OSHA/Shop/Heavy equipment), module cards with progress + Play/Continue/Replay, "View more courses", then Upcoming courses. Live: "Upcoming courses and crew registration", Wildland Training Portal link, Scheduled courses list, New training. | 🧩 Modules/XP/Rewards = new feature. Keep the live scheduled-courses section. |
| Settings | Sandbox: single "Switch to dark mode" toggle; adds **Employee rewards / XP by category / Prize catalog**; Audit log link. Live: System/Light/Dark segmented + Customize Operations. | ✅ Keep the live theme control (#15). 🧩 Rewards settings = new feature. |
| Qualifications, Roster, Documents, Invoices, Payroll, Availability | Same structure; only the title font differs (1.4). Sandbox Qualifications/Availability show a Back button that live omits. | ✅ No work beyond optional Back buttons. |
| Audit log | Live: in sidebar. Sandbox: inside Tools. | ✅ Covered by 1.1. |

## 6. New features → placeholders (sandbox uses demo stores only, no backend)

Add each as a "Coming soon" tile, page or section so it's visible but clearly not implemented:

| Feature | Sandbox source (web) | Mobile in sandbox? | Suggested placeholder |
|---------|---------------------|--------------------|-----------------------|
| **News Feed** (NWCG, Contracting/SAM.gov alerts matched to fleet, Fire Science, NIFC outlook, National Fire Activity) | `NewsFeed.tsx/.css`, `news-feed-demo.ts`, `public/news/*` | No (web-only) | Sidebar item + mobile More tile → "Coming soon" page |
| **Meetings / video chat** | `MeetingsPage.tsx/.css`, `meetings-demo.ts` | No | Tools tile "Meetings · Coming soon" (web + mobile) |
| **Marketplace** (listings + Comms threads) | `MarketplacePage.tsx/.css`, `marketplace-demo.ts`, `public/marketplace/*` | No | Already a "Coming soon" tile on live ✅ |
| **Training modules + XP + levels** | `TrainingCatalog.tsx/.css`, `training-demo-modules.ts`, `packages/domain/training-scaffolding.ts` | **Yes**: `components/training-catalog.tsx`, `training/module/[slot]`, `training/signoff/[id]`, `training/track/[code]` | "Modules · Coming soon" card above Scheduled courses |
| **Rewards / Redeem XP + prize catalog** | `RewardsPage.tsx/.css`, `rewards-demo-store.ts`, `CompanyRewardsSettings.tsx`, `public/rewards/*` | No | Disabled "Redeem XP" button + Settings "Employee rewards · Coming soon" |
| **Travel restaurants search** | `travel-restaurants.ts` + HotelsPage section | No | "Restaurants · Coming soon" card on Travel |
| **Workforce** | tile only | — | Already a placeholder on live ✅ |

## 7. Mobile-specific notes

- `main` mobile is **ahead** of the sandbox in: combined Dashboard/Operations tab (#32), `HeroTitle` and
  `accent-tile` components, Send to VIPR, VIPR Intelligence, QuickBooks status, theme preference,
  operations map, shop store and unit screens. The sandbox **deletes** these, so never copy sandbox
  mobile files wholesale.
- Sandbox mobile tab bar: Dashboard, Operations, Fleet, Messages, More (separate tabs). `main`: Operations
  (merged), Fleet, Messages, More. ✅ Keep `main`.
- Worth porting to mobile alongside web: Fleet row details (3.3), Command card colors (2.3), greeting card
  if chosen (2.1), alert "Clear" (2.4), plus the placeholders in section 6.

## Suggested order

1. 🎨 Fleet row details (3.3), web + mobile
2. 🎨 Alert row Clear (2.4), web + mobile
3. 🎨 Command card color palette (2.3), web + mobile
4. 🧩 Placeholders: News Feed, Meetings, Training modules, Rewards, Restaurants
5. ⚖️ Decisions: greeting card (2.1), dashboard order (2.2), notifications panel (2.6), Fleet summary
   tiles and Current issues (3.2/3.4), sidebar label "Tools" vs "More" (1.2)
6. Optional: seed demo Shop jobs and receipts so the live demo matches the sandbox's richer data
