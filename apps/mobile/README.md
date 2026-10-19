# FireOps mobile

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

Set `EXPO_PUBLIC_WEB_URL` to the deployed FireOps web origin in `.env.local` and the EAS build environment. Deploy the matching web version with `?demo=1` support before releasing mobile. Explore demo opens that same interactive, account-free demo in an in-app browser (Safari view on iOS, Custom Tab on Android); closing it returns to sign-in. It does not sign in or alter native company records. The `expo-web-browser` native dependency requires a new iOS/Android build, not only a JavaScript update. Exiting the web demo removes the demo query flag. Without a configured web origin, the app reports a configuration error instead of guessing a hostname.

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
