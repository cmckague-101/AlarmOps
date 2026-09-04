# FireOps mobile

Expo/React Native client for iOS and Android.

## Setup

Copy `.env.example` to `.env.local` and fill in same Supabase project values used by web app.

```bash
npm run ios
npm run android
```

Run commands from repository root. Supabase anon key is publishable; never place service-role credentials in Expo environment variables.

## TestFlight

See [`TESTFLIGHT.md`](./TESTFLIGHT.md) for first-time Apple/EAS setup, release checks, submission, and future update steps.
