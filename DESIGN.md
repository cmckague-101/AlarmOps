---
name: FireOps Fleet
description: Operational fleet management for wildland fire contractors.
colors:
  action-ember: "#c94321"
  action-ember-deep: "#a93417"
  command-ink: "#19201d"
  operational-green: "#26765a"
  warning-ochre: "#7b5014"
  danger-red: "#98392e"
  canvas: "#f6f7f4"
  paper: "#ffffff"
  divider: "#d9ded9"
  secondary-text: "#5f6963"
  focus-green: "#315f48"
  command-surface: "#26342c"
  command-border: "#405047"
  strong-secondary: "#46514b"
  deep-secondary: "#4d5952"
  field-secondary: "#4d5a53"
  label-secondary: "#4f5b54"
  icon-secondary: "#526058"
  steel-secondary: "#65716a"
  metadata: "#666f69"
  legacy-secondary: "#69716c"
  muted-admin: "#78817c"
  warning-label: "#854b16"
  quiet-label: "#89918c"
  hint-text: "#8b938e"
  credential-muted: "#919994"
  owner-label: "#929a95"
  header-muted: "#9daba3"
  warning-legacy: "#ad641e"
  error-surface: "#fae9e6"
  assignment-border: "#cde3da"
  focus-surface: "#dce8e1"
  selection-surface: "#f2c5b8"
  storage-border: "#d9a49d"
  dark-canvas: "#0F1317"
  dark-elevated: "#13191F"
  dark-paper: "#181E24"
  dark-surface-alt: "#222A32"
  dark-surface-pressed: "#29333D"
  dark-border: "#303A44"
  dark-border-strong: "#46525E"
  dark-text: "#F7F8FA"
  dark-text-secondary: "#D7DDE3"
  dark-muted: "#A9B2BC"
  dark-disabled: "#68737E"
  dark-red: "#E83426"
  dark-red-deep: "#B82118"
  dark-red-subtle: "#3B211F"
  dark-green: "#3CA66B"
  dark-green-deep: "#26784A"
  dark-green-subtle: "#193126"
  dark-amber: "#F0A93B"
  dark-amber-subtle: "#3A2D1A"
  dark-blue: "#4E91E6"
  dark-blue-subtle: "#1C2D42"
  dark-selection: "#B82118"
  mobile-nav-dark: "rgba(24,30,36,.96)"
  drawer-shadow: "rgba(0,0,0,.18)"
  floating-action-shadow: "rgba(192,65,31,.34)"
typography:
  headline:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "clamp(1.6875rem, 2vw, 2rem)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
  micro-8:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "8px"
  micro-9:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "9px"
  micro-10:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "10px"
  micro-11:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "11px"
  compact-body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "13px"
  mobile-input:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "16px"
  stat:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 800
  mobile-title:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
  avatar:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 800
rounded:
  input: "8px"
  control: "9px"
  compact-card: "10px"
  drawer-section: "12px"
  card: "14px"
  auth-card: "16px"
  status: "20px"
  floating-action: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action-ember}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
  button-primary-hover:
    backgroundColor: "{colors.action-ember-deep}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.command-ink}"
    rounded: "{rounded.card}"
    padding: "18px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.command-ink}"
    rounded: "{rounded.control}"
    height: "44px"
---

# Design System: FireOps Fleet

## Overview

**Creative North Star: "The Field Command Ledger"**

FireOps pairs field-ready density with calm administrative structure. Interface reads like maintained operations equipment: dark command navigation, pale work surfaces, explicit status language, and restrained ember accents reserved for actions and wayfinding.

Desktop favors fast scanning across fleet records. Mobile preserves same operational facts in thumb-reachable lists and drawers. Decoration stays secondary to status, ownership, and next action.

**Key Characteristics:**
- Warm neutral canvas with crisp paper work areas.
- Neutral charcoal surfaces and navigation keep dark mode free of green tint.
- Ember marks primary actions; semantic colors mark operational state.
- Compact lists preserve high information density without table rigidity.

## Colors

Palette is warm, restrained, and functional. Every saturated color carries action, focus, or operational state.

### Primary
- **Action Ember:** Primary buttons, active mobile navigation, links, and selected controls.
- **Deep Ember:** Hover and pressed treatment for primary actions.

### Secondary
- **Operational Green:** Ready, complete, active, and resolved states.
- **Warning Ochre:** Maintenance, open work, and attention states.
- **Danger Red:** Errors, critical issues, and out-of-service states.

### Neutral
- **Command Ink:** Primary text and dark navigation.
- **Canvas:** Application background.
- **Paper:** Cards, forms, drawers, and elevated work areas.
- **Divider:** Borders and list separation.
- **Secondary Text:** Supporting copy and metadata.

**The Ember Rarity Rule.** Ember identifies action or location. It is not decoration.

**The Red Means Blocked Rule.** Danger red is reserved for errors, critical conditions, and unavailable equipment.

## Typography

**Display Font:** Manrope with system sans fallback
**Body Font:** DM Sans with system sans fallback

**Character:** Manrope gives headings compact authority. DM Sans keeps dense operational records legible.

### Hierarchy
- **Headline:** Heavy, compact page and drawer titles.
- **Title:** Section headings and record names.
- **Body:** Instructions, descriptions, and form content.
- **Label:** Controls, metadata, statuses, and compact navigation.

**The Operational Minimum Rule.** Mobile controls use at least 16px input text. Secondary interface text never replaces required operational facts.

## Layout

Desktop uses fixed 242px navigation and a centered work area capped at 1240px. Pages use 40px vertical and 44px horizontal padding. Dense content sits in bordered lists rather than grids of interchangeable cards.

At 800px and below, navigation moves to a safe-area-aware bottom bar, forms become single-column, drawers fill viewport width, and primary creation actions move near thumb reach. Touch targets are at least 44px on coarse pointers. Narrow layouts reflow metadata instead of hiding issue state.

## Elevation & Depth

Most hierarchy comes from surface tone and 1px borders. Shadows appear on drawers, toasts, and floating actions where spatial separation matters.

### Shadow Vocabulary
- **Ambient Overlay:** Soft offset shadow for drawers and transient feedback.

**The Flat Work Surface Rule.** Lists and cards remain flat at rest. Shadows indicate elevation, not decoration.

## Shapes

Controls use compact 8–9px corners. Work panels use 12–14px corners. Statuses and counts use pills. Vehicle imagery uses softly rounded rectangular crops. Brand mark alone uses clipped geometry.

## Components

### Buttons
- **Shape:** Compact rounded control, 9px radius.
- **Primary:** Ember background with white text at WCAG AA contrast.
- **Hover / Focus:** Deep ember hover; 3px green focus ring with offset.
- **Secondary:** Paper surface, divider border, command-ink text.

### Chips
- **Style:** Pale semantic background, dark semantic text, compact uppercase label.
- **State:** Text, icon, and shape reinforce color meaning.

### Cards / Containers
- **Corner Style:** 12–14px.
- **Background:** Paper over warm canvas.
- **Shadow Strategy:** Flat by default.
- **Border:** 1px divider.
- **Internal Padding:** Usually 16–24px.

### Inputs / Fields
- **Style:** Paper fill, 1px divider, 8px radius, 44px minimum height.
- **Focus:** Green border and soft green ring.
- **Error / Disabled:** Linked inline error text, `aria-invalid`, and reduced-opacity disabled state.

### Navigation
- Desktop navigation uses command ink with pale labels and a restrained active surface. Mobile navigation is fixed, safe-area-aware, and marks current page through color plus `aria-current`.

### Operational list row
- Full-row button keeps record title, status, supporting metadata, and disclosure arrow in one scan path. Hover changes surface tone without moving layout.

## Do's and Don'ts

### Do:
- **Do** reserve ember for primary actions, focus, and wayfinding.
- **Do** keep status text visible alongside semantic color.
- **Do** preserve operational issue counts at every viewport.
- **Do** use bordered paper surfaces for dense work areas.

### Don't:
- **Don't** hide task-critical metadata to make mobile layouts fit.
- **Don't** use shadows on every card.
- **Don't** introduce new literal colors when a semantic token exists.
- **Don't** use animation without state, feedback, or spatial meaning.

## Native Sign-in Landing

Native iOS and Android sign-in keeps the auth form first, with Explore demo below it and a bottom down-arrow affordance labeled “Tap or scroll down.” The arrow scrolls to the feature list. On small screens or with larger text, the hero grows rather than clipping controls. Features follow web order and copy, then all five pricing plans and tappable phone/email contact details; the FireOps mobile promotion is omitted. Existing theme tokens cover light/dark surfaces and text. Bundled preview images reuse existing web product screenshots; provenance is in `apps/mobile/assets/landing/README.md`.

Explore demo opens the existing web demo in an in-app browser (iOS Safari view / Android Custom Tab), with native dismissal returning to sign-in, using the configured `EXPO_PUBLIC_WEB_URL` and explicit `?demo=1` entry. Native authentication and company records stay untouched. Static finish review: native scroll/keyboard handling, accessible headings and link/button labels, minimum 44px action targets, and explicit link/configuration errors. Verdict: type checks and targeted demo tests pass; visual/device review intentionally deferred to user.

## Owner Command Center

The owner dashboard on web and mobile uses the supplied command-center reference: a personalized greeting, Command Center heading with the local date, and four large disclosure cards in red, green, blue, and amber. Cards use two columns, with native mobile falling back to one column for narrow screens or enlarged text. Existing light and dark themes remain supported. Detail views show incident resource groups, personnel with all their vehicle assignments, vehicle fire assignments, and unresolved reported issues ordered by priority. Record titles open existing crew, vehicle, or issue details. Empty and mobile loading/error states use explicit text. Crew dashboards retain their existing behavior.
