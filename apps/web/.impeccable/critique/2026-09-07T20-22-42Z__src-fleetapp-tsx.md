---
target: web login design
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ryan/dev/fireops/apps/web/src/FleetApp.tsx"
target_fingerprint: "sha256:d3fef8a2a65bb83cef38ca91b81db7a86433628472a03f5937f645376845c2f9"
target_path: /Users/ryan/dev/fireops/apps/web/src/FleetApp.tsx
timestamp: 2026-09-07T20-22-42Z
slug: src-fleetapp-tsx
---
## FireOps Web Login Critique

**Target:** `apps/web/src/FleetApp.tsx` with `src/auth.css`

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Submit, reset, success, and alert states exist; email-request failures disappear |
| 2 | Match System / Real World | 4 | Wildland readiness language fits audience and mission |
| 3 | User Control and Freedom | 3 | Forgot-password and return paths are clear; no password visibility control |
| 4 | Consistency and Standards | 2 | Marketing login and reset-password state feel like separate products |
| 5 | Error Prevention | 2 | Native constraints help, but no password reveal or pre-submit guidance |
| 6 | Recognition Rather Than Recall | 3 | Labels, autocomplete, and primary action are explicit |
| 7 | Flexibility and Efficiency | 3 | Native keyboard flow is efficient for simple sign-in |
| 8 | Aesthetic and Minimalist Design | 2 | Strong hero, but six-card marketing page overextends an invite-only login |
| 9 | Error Recovery | 1 | Raw Supabase errors leak through; reset/magic-link errors are ignored |
| 10 | Help and Documentation | 2 | Contact exists, but no contextual recovery help |
| **Total** |  | **25/40** | **Acceptable — significant fixes needed** |

### Design Specificity Verdict

**LLM assessment:** Authored surface at macro level, category-interchangeable at detail level. Dark field-command palette, ember action, readiness language, and operational typography clearly belong to FireOps. Yet concentric glow, security shield, three generic proof statements, six equal feature cards, and oversized closing CTA follow familiar B2B SaaS landing-page grammar. No tangible operational artifact—incident assignment, readiness status, credential state, or vehicle detail—proves product’s distinct value.

**Deterministic scan:** `impeccable detect --json src/FleetApp.tsx` returned **0 findings**. No automated rule violations. Manual review still found contrast, touch-target, recovery, and product-specificity problems outside detector coverage.

**Visual overlays:** None. Browser automation tool unavailable, so no reliable user-visible overlay. Fallback evidence: source inspection, computed contrast checks, responsive CSS review, and successful production build.

### Overall Impression

Confident, polished first viewport. Sign-in action reads immediately and aesthetic fits operational software. Biggest opportunity: stop behaving like generic marketing site beneath fold and make trust concrete through real FireOps workflow evidence and resilient auth recovery.

### What’s Working

1. **Strong task hierarchy.** Sign-in form stays visible beside positioning copy; fields and CTA form clean scan path.
2. **Brand-fit visual world.** Command-dark hero, restrained ember, Manrope headings, warm canvas, and bordered feature grid align with Field Command Ledger direction.
3. **Solid baseline accessibility.** Semantic labels, autocomplete, native form controls, alerts/status roles, visible focus treatment, and reduced-motion handling are present.

### Cognitive Load

**Low-to-moderate: 2 checklist failures.**

- **Single focus fails:** login task competes with contact, discovery cue, three proof claims, and full marketing journey.
- **Chunking fails:** six equally weighted feature cards provide no recommended reading path.
- No decision point exceeds four interactive choices.
- Form itself stays compact and understandable.

### Emotional Journey

Opening creates competence and security. “Protected workspace” reassures appropriately. Emotional valley arrives on failure: raw provider copy can feel technical or accusatory, while reset-link failure may falsely transition into success. Ending returns to generic sales language rather than concrete operational confidence.

### Priority Issues

#### **[P1] Auth recovery can mislead users**

**What:** `requestEmail` ignores Supabase errors, then always sets `sentMethod`. Main sign-in renders `signInError.message` verbatim.

**Why it matters:** User may be told email is coming when request failed. Raw provider errors weaken trust during highest-stress moment.

**Fix:** Branch on request error, retain entered email, map known auth failures to plain language, provide actionable retry/contact path, and announce busy state.

**Suggested command:** `$impeccable harden`

#### **[P1] Mobile form misses stated accessibility floor**

**What:** Login input selector fixes text at `15px`, overriding earlier mobile `16px` rule through higher specificity. Forgot-password control has tiny text and no 44px minimum target. Mobile Contact becomes visually icon-only.

**Why it matters:** iOS may zoom inputs unexpectedly. Small targets fail field-use and motor-access needs. Icon-only contact reduces recognition.

**Fix:** Set login inputs to at least `16px`; give tertiary actions 44×44px hit areas; preserve visible “Contact” label on mobile.

**Suggested command:** `$impeccable adapt`

#### **[P2] Secondary text fails contrast**

**What:** Form note is 3.10:1, “Secure access” is 3.74:1, and ember kicker is 4.28:1. All are small text requiring 4.5:1.

**Why it matters:** Security context and section labels become hard to read for low-vision users, especially outdoors.

**Fix:** Move small copy to stronger semantic text tokens; verify every 10–12px label against WCAG AA.

**Suggested command:** `$impeccable audit`

#### **[P2] Login page over-markets an invite-only product**

**What:** Six equal feature cards, mission block, contact block, and footer create long sales journey after prominent sign-in form.

**Why it matters:** Returning crew and owners need rapid access. Generic feature volume dilutes product specificity and creates mismatch with invite-only positioning.

**Fix:** Keep first viewport task-led. Reduce lower page to 2–3 concrete operational proof modules—assigned incidents, vehicle readiness, crew credentials—without fabricated data or claims.

**Suggested command:** `$impeccable distill`

#### **[P2] Auth states lose visual continuity**

**What:** Forgot-password replaces authored landing page with generic centered admin card. Layout, typography, environmental context, and reassurance change abruptly.

**Why it matters:** Flow feels bolted on exactly when user needs continuity and confidence.

**Fix:** Keep recovery inside same branded auth shell, preserve form position and entered email, and transition heading/actions without replacing visual world.

**Suggested command:** `$impeccable polish`

### Persona Red Flags

**Jordan — First-Timer**
- “Live operational visibility” and “field intelligence” remain abstract without example.
- Invite-only status is not stated near form; user cannot tell whether signup is unavailable or missing.
- Raw auth errors offer no guided next step.

**Sam — Accessibility-Dependent**
- Small secondary copy fails AA contrast.
- Forgot-password target lacks robust hit area.
- Busy button text changes, but form has no explicit `aria-busy` or status announcement.
- Source semantics are good overall; main flow remains keyboard-operable.

**Casey — Distracted Mobile User**
- 15px fields risk viewport zoom during sign-in.
- Long marketing content pushes support context far below task.
- Mobile Contact loses text label.
- Recovery retains email, which helps interrupted users.

### Minor Observations

- Gradient submit treatment conflicts with DESIGN.md’s solid ember primary-button token and Ember Rarity Rule.
- Form’s large decorative shadow exceeds flat-work-surface guidance, though elevation is defensible for auth focus.
- “Live operational visibility” may imply freshness guarantee; confirm claim against actual incident-update behavior.
- No password visibility toggle increases typo risk.
- Build passes successfully.

### Questions to Consider

- Should login serve returning users first, or split marketing and authentication into separate routes?
- What real operational artifact could replace generic proof claims without exposing customer data?
- Should password recovery remain embedded in same auth shell rather than switching layouts?
