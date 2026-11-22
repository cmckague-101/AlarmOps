# AlarmOps mobile

Expo/React Native client for iOS and Android.

Android local APK builds, Supabase environment setup, and cloud-device testing: [`ANDROID_TESTING.md`](./ANDROID_TESTING.md).

## Setup

Copy `.env.example` to `.env.local` and fill in same Supabase project values used by web app.

```bash
npm run ios
npm run android
```

Run commands from repository root. Supabase anon key is publishable; never place service-role credentials in Expo environment variables.

## Sign-in landing and demo

Sign-in includes a bottom down-arrow button and scrollable feature previews, followed by pricing and phone/email contact links. The web-only FireOps mobile promotion is omitted.

**Explore demo** opens the existing native iOS/Android screens with a sample North Ridge company, fleet, crew/qualifications, maintenance issue, chat, training, inventory, payroll, and invoice. No account, deployed website, or Supabase configuration is required. Demo records live only in memory; the persistent banner's **Exit demo** action discards changes and returns to sign-in. Restarting the app also discards the demo. Each entry uses a fresh company scope so cached native screen state cannot restore a previous demo's edits.

The demo uses an isolated local Supabase-compatible adapter, including local change subscriptions; it never uses production database, storage, auth, realtime, or offline-cache persistence. Fleet edits/inspections/issues, crew details/qualifications, chat replies/read markers, training signups, inventory checkout/check-in, and invoice/payroll workflows operate on session data. Uploads/downloads, invitations/removal, feedback submission, qualification-card approval services, and Motive authorization/camera actions report explicit demo-only restrictions instead of contacting services. Dashboard national fire activity and VIPR DPLs use static fictional fixtures shared with the web demo. VIPR starts with Northern California → Redding → Type 3 Engines; Water Tenders is also selectable, including matched, unmatched, and ambiguous rate examples. Both panels label their figures as sample data, not official/current reports. Fleet cards and vehicle details use bundled copies of the three web demo vehicle photos (`assets/demo-vehicles/README.md`), without storage requests. Public live incident maps and user-opened contact/official-source links remain separate from sample records and may need a connection.

Targeted validation: `npm run test --workspace=@fireops/mobile -- src/lib/demo-client.test.ts` and `npm run typecheck --workspace=@fireops/mobile`.

Device review (run by the user): enter demo from sign-in; navigate all five tabs; edit a vehicle and create/resolve an issue; add a chat reply; check inventory out/in; inspect sample payroll/invoice; verify upload/invite restrictions; confirm dashboard sample fire activity, switch both VIPR priority lists, and view all three fleet photos (including offline); exit from a detail screen; enter again and confirm changes reset; then sign in normally and verify real company data is unaffected. Repeat on iOS/Android, including offline entry and app restart.

Feature screenshots are bundled copies of `apps/web/public/landing/`; see `assets/landing/README.md`.

## Push notifications

1. Apply `supabase/migrations/20260906161500_add_push_notification_tokens.sql` and `supabase/migrations/20260909000100_notification_inbox_and_delivery.sql`.
2. Configure APNs and FCM credentials with `eas credentials`.
3. Deploy and schedule `supabase/functions/dispatch-push-notifications`.
4. Build and install app on physical device. Remote push does not work in Expo Go or simulator.
5. Sign in and grant notification permission. App registers Expo token in `public.push_tokens`.

Payloads use validated local `data.path` routes and persistent `data.notificationId` values. Tapping marks inbox event read before opening destination. `unregisterFromPushNotifications()` runs before sign-out.

Full event matrix, architecture, deployment, secrets, and verification: [`../../docs/push-notifications.md`](../../docs/push-notifications.md).

## Production deployment

From a clean Git worktree, queue an iOS production build with automatic App Store Connect submission and an Android production build without submission:

```bash
npm run deploy:mobile:production
```

Both builds run asynchronously in EAS. Successful iOS submission uploads to App Store Connect; it does not publish the app without App Review and release. Android artifact remains in EAS for download or later submission.

## TestFlight

See [`TESTFLIGHT.md`](./TESTFLIGHT.md) for first-time Apple/EAS setup, release checks, submission, and future update steps.
