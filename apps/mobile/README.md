# FireOps mobile

Expo/React Native client for iOS and Android.

## Setup

Copy `.env.example` to `.env.local` and fill in same Supabase project values used by web app.

```bash
npm run ios
npm run android
```

Run commands from repository root. Supabase anon key is publishable; never place service-role credentials in Expo environment variables.

## Push notifications

1. Apply `supabase/migrations/20260906161500_add_push_notification_tokens.sql` to the linked Supabase project.
2. Configure APNs and FCM credentials with `eas credentials`.
3. Build and install the app on a physical device. Remote push does not work in Expo Go or a simulator.
4. Sign in and grant notification permission. The app registers its Expo push token in `public.push_tokens`.

Notification payloads may include a local app path. Tapping the notification opens that route:

```json
{
  "title": "Incident assigned",
  "body": "You were assigned to Incident 123",
  "data": { "path": "/incidents/123" }
}
```

Call `unregisterFromPushNotifications()` from `src/lib/notifications.ts` before signing out. Server-side sending and event rules belong in a Supabase Edge Function; service-role credentials must never be included in the app.

## TestFlight

See [`TESTFLIGHT.md`](./TESTFLIGHT.md) for first-time Apple/EAS setup, release checks, submission, and future update steps.
