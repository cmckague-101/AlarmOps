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

### 7. Create or connect App Store Connect app

In App Store Connect → Apps:

1. Create app named FireOps if no record exists.
2. Select same bundle identifier from `app.json`.
3. Set SKU, primary language, and user access.
4. Record Apple app ID for troubleshooting/submission.

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

## Future updates

### Code-only or native update

Every TestFlight update follows same signed-build path; this project does not currently use EAS Update.

1. Pull clean release branch.
2. Make changes and update tests.
3. Run release checks above.
4. For user-visible release, update `expo.version` in `app.json`, for example `1.0.0` → `1.1.0`.
5. Commit changes.
6. Build and submit:

```bash
cd apps/mobile
npx eas-cli build --platform ios --profile production --auto-submit
```

`autoIncrement` supplies a new iOS build number. Never reuse an uploaded build number for same marketing version.

### Version rules

- `expo.version`: customer-visible marketing version (`CFBundleShortVersionString`). Change for planned releases.
- iOS build number: upload identifier (`CFBundleVersion`). Production EAS profile increments it automatically.
- Bundle identifier: permanent. Never change for updates.
- EAS project ID: permanent link to Expo project. Do not remove or replace casually.

### Rollback

TestFlight cannot replace an uploaded binary. To fix regression:

1. Stop assigning affected build to tester groups.
2. Revert/fix code.
3. Build again; EAS creates higher build number.
4. Submit and assign replacement build.

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
