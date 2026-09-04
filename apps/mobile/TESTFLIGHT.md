# FireOps TestFlight runbook

Run commands from `apps/mobile` unless stated otherwise.

## One-time setup

### 1. Confirm Apple access

Apple ID must belong to active Apple Developer Program team. In App Store Connect, confirm access to:

- Apps
- TestFlight
- Certificates, Identifiers & Profiles
- Agreements, Tax, and Banking

An ordinary Apple ID without paid Developer Program membership cannot distribute TestFlight builds.

### 2. Permanent bundle identifier

FireOps uses:

```text
com.tinykings.fireops
```

It is configured in `app.json` and registered in App Store Connect. Bundle identifier cannot be changed for future updates.

### 3. Production app icon

The dedicated iOS icon is `assets/images/fireops-ios-icon.png`, generated from approved source artwork. It is configured in `app.json` and meets upload requirements:

- 1024 x 1024 PNG
- RGB with no alpha/transparency
- Square source; iOS applies device-specific corner masks

### 4. Link Expo Application Services (EAS)

Install/login and initialize project:

```bash
npx eas-cli login
npx eas-cli init
```

`eas init` adds `expo.extra.eas.projectId` to `app.json`. Commit that project ID; it is not secret.

Check selected account and project:

```bash
npx eas-cli whoami
npx eas-cli project:info
```

### 5. Configure production environment

Create `production` environment variables in Expo dashboard or with EAS CLI:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

These values are embedded in app and must only contain publishable client credentials. Never add Supabase service-role key.

Verify production environment:

```bash
npx eas-cli env:list --environment production
```

### 6. Configure password-reset redirect

In Supabase Dashboard → Authentication → URL Configuration, allow mobile redirect URL:

```text
fireops://reset-password
```

Test forgot-password flow from installed build, including opening email link back into FireOps.

### 7. App Store Connect app

Registered app details:

```text
App Store name: FireOps Fleet
Bundle ID:      com.tinykings.fireops
Apple app ID:   6808795667
Expo project:   @ryan.inslee/fireops
```

Use this existing App Store Connect record for every update. Never create another app record for a new version.

EAS can manage distribution certificates and provisioning profiles during first build. Select correct Apple team when prompted. Do not commit downloaded keys or profiles.

### 8. Complete TestFlight/App Store metadata

Prepare:

- Privacy policy URL
- Support URL and contact
- App description/category
- App privacy answers
- Beta description and review notes
- Demo owner/member credentials for review
- Screenshots for supported devices

Explain that FireOps is invite-only and give reviewer usable credentials plus navigation steps. If iPad support is not intended, set `ios.supportsTablet` to `false` before screenshots and first release.

## First TestFlight build

### 1. Release checks

From repository root:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run lint --workspace=@fireops/mobile
cd apps/mobile && npx expo-doctor
```

Then test production behavior:

- Sign in and sign out
- Password-reset deep link
- Fleet status and assignment mutations
- Vehicle photo/document upload and open
- Operations map and incident discovery
- Web/mobile realtime changes
- Light/dark mode
- At least one physical iPhone

Do not release with uncommitted dependency or patch changes:

```bash
git status --short
```

### 2. Inspect generated iOS configuration

```bash
npx expo config --type public
```

Confirm app name, version, bundle identifier, icon, scheme, and EAS project ID.

### 3. Build signed archive

```bash
npx eas-cli build --platform ios --profile production
```

First run asks for Apple login/team and credential-management permission. Let EAS manage credentials unless project adopts manual credential storage.

Production profile uses remote app versioning and automatically increments iOS build number.

### 4. Submit build

After successful build:

```bash
npx eas-cli submit --platform ios --profile production --latest
```

Or upload during build:

```bash
npx eas-cli build --platform ios --profile production --auto-submit
```

Processing in App Store Connect commonly takes several minutes. Open TestFlight and resolve export-compliance prompts if shown. `ITSAppUsesNonExemptEncryption` is declared false in `app.json` for standard exempt HTTPS use; revisit if non-exempt/custom encryption is added.

### 5. Distribute

- Internal testers: select processed build and add internal group. No Beta App Review required.
- External testers: complete beta metadata, add external group, then submit build for Beta App Review.

TestFlight builds expire after 90 days.

## Routine update: code to App Store Connect

Every update requires a new signed iOS build. This project does not currently use EAS Update.

### 1. Develop on a branch

Start from current `main`:

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/short-description
```

Make code changes. If dependencies change, commit both `package.json` and root `package-lock.json`. Never commit `.env.local`, Apple credentials, provisioning profiles, or service-role keys.

Run relevant simulator/device checks while developing:

```bash
# From repository root
npm run ios
```

### 2. Verify and merge

Run full release checks from repository root:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run lint --workspace=@fireops/mobile
cd apps/mobile && npx expo-doctor
```

Commit, push, open a pull request, and wait for CI:

```bash
git add <reviewed-files>
git commit -m "describe update"
git push -u origin HEAD
```

Merge pull request into `main`. Production builds should come from updated, clean `main`, not an uncommitted working tree:

```bash
git switch main
git pull --ff-only origin main
git status --short
```

`git status --short` must produce no output.

### 3. Choose version

For another TestFlight iteration of same release, leave `expo.version` unchanged. EAS creates a higher build number automatically.

For a new customer-visible release, update `expo.version` in `app.json` before merging:

```json
"version": "1.1.0"
```

Version meanings:

- `expo.version`: customer-visible version, such as `1.1.0` (`CFBundleShortVersionString`).
- EAS remote iOS build number: unique upload number (`CFBundleVersion`). `autoIncrement` manages it.
- Bundle identifier: permanently `com.tinykings.fireops`; never change it for updates.
- EAS project ID: permanent Expo project link; do not remove or replace it.

Never manually re-add `ios.buildNumber` to `app.json`; remote EAS versioning owns it.

### 4. Build and submit

From clean `main`:

```bash
cd apps/mobile
npx eas-cli whoami
npx eas-cli env:list --environment production
npx eas-cli build --platform ios --profile production --auto-submit
```

Expected account is `ryan.inslee`. Confirm production environment lists both Supabase variables. EAS reuses managed Apple distribution certificate and provisioning profile; Apple login is not normally required for each build.

Build and submission run in Expo cloud. Terminal can be closed after jobs are accepted. Track them with:

```bash
npx eas-cli build:list --platform ios --limit 1
npx eas-cli submit:list --platform ios --limit 1
```

Expected sequence:

```text
Build:      IN_QUEUE → IN_PROGRESS → FINISHED
Submission: IN_QUEUE → IN_PROGRESS → FINISHED
```

Do not start another submission while current one is queued. A finished EAS submission means upload reached Apple; Apple processing happens afterward.

### 5. Activate build in TestFlight

In App Store Connect → FireOps Fleet → TestFlight:

1. Wait for Apple processing to finish.
2. Open new version/build.
3. Resolve export compliance or missing metadata prompts.
4. Add build to internal tester group.
5. Install update through TestFlight and run physical-device smoke test.
6. For external testers, add build to external group and submit for Beta App Review.

TestFlight builds expire after 90 days. Uploading a build does not automatically release it publicly in App Store.

### 6. Release publicly in App Store

When tested build is ready for customers:

1. Open App Store Connect → FireOps Fleet → App Store.
2. Create/select iOS version matching `expo.version` exactly.
3. Complete version description, screenshots, privacy details, support URL, and review notes.
4. Select tested build from TestFlight/build picker.
5. Choose manual, automatic, or phased release behavior.
6. Submit version for App Review.
7. After approval, release according to selected behavior.

For later fixes to same App Store version, upload a higher build number and select replacement build before review. Once version is released, next public update needs a higher `expo.version`.

### Rollback or failed build

Uploaded binaries cannot be replaced or deleted from Apple's history. To fix regression:

1. Remove affected build from tester groups or stop public rollout where possible.
2. Revert/fix code on a new branch and merge it.
3. Build again; EAS creates higher build number.
4. Submit and assign replacement build.

If EAS build fails, inspect build logs, fix cause, and run build command again. Failed builds do not need App Store Connect cleanup.

## Release checklist

- [ ] Clean Git state and reviewed release commit
- [ ] Typecheck, tests, web build, mobile lint, and Expo Doctor pass
- [ ] Production Supabase environment selected
- [ ] Physical-device smoke test passes
- [ ] Password-reset deep link passes
- [ ] `expo.version` correct
- [ ] EAS production build succeeds
- [ ] App Store Connect processing/compliance complete
- [ ] Internal TestFlight group validates build
- [ ] External Beta App Review submitted when needed
