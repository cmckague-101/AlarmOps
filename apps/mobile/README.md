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

## Push notifications

1. Apply `supabase/migrations/20260906161500_add_push_notification_tokens.sql` and `supabase/migrations/20260909000100_notification_inbox_and_delivery.sql`.
2. Configure APNs and FCM credentials with `eas credentials`.
3. Deploy and schedule `supabase/functions/dispatch-push-notifications`.
4. Build and install app on physical device. Remote push does not work in Expo Go or simulator.
5. Sign in and grant notification permission. App registers Expo token in `public.push_tokens`.

Payloads use validated local `data.path` routes and persistent `data.notificationId` values. Tapping marks inbox event read before opening destination. `unregisterFromPushNotifications()` runs before sign-out.

Full event matrix, architecture, deployment, secrets, and verification: [`../../docs/push-notifications.md`](../../docs/push-notifications.md).

## TestFlight

See [`TESTFLIGHT.md`](./TESTFLIGHT.md) for first-time Apple/EAS setup, release checks, submission, and future update steps.
