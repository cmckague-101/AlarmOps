# Android APK build and cloud-testing runbook

Run commands from `apps/mobile` unless stated otherwise.

## Supabase environment variables

FireOps requires these build-time Expo variables:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

`EXPO_PUBLIC_*` values are embedded into the APK. Use only Supabase URL and publishable/anon key; never use a service-role key.

### EAS preview builds

The `preview` build profile uses EAS's `preview` environment. This project's `.env.local` contains the two required variable names. Push their local values to EAS with:

```bash
npx eas-cli env:push --environment preview --path .env.local
```

Alternatively, in Expo dashboard, open the FireOps project and add both variables under **Environment variables → preview**.

Verify them before building:

```bash
npx eas-cli env:list --environment preview
```

Changing EAS variables cannot repair an APK already built. Create and test a new APK after adding them.

### Local builds

Local development reads values from `.env.local`. Create it from the example if needed:

```bash
cp .env.example .env.local
```

Fill in the same Supabase URL and publishable/anon key used by the web app. `.env.local` is ignored by Git and must not be committed.

## Build APK locally with EAS

This runs the build on the local machine and does not consume EAS cloud-build quota. EAS CLI may still contact Expo for project configuration and credentials.

Requirements:

- Android Studio and Android SDK
- JDK 17
- Node dependencies installed
- EAS login and Android signing credentials

### macOS toolchain setup

Install JDK 17 on Apple Silicon macOS:

```bash
brew install openjdk@17
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
```

To retain this configuration in future terminal sessions, add the two `export` lines to `~/.zshrc`.

If the next build reports a missing Android SDK, install Android Studio and use its SDK Manager to install the requested Android SDK Platform and Build Tools. An emulator is not required for APK compilation.

Load `.env.local` into the build process and build the `preview` profile:

```bash
(
  set -a
  source .env.local
  set +a
  npx eas-cli build \
    --platform android \
    --profile preview \
    --local \
    --output "$PWD/fireops-preview.apk"
)
```

Result:

```text
apps/mobile/fireops-preview.apk
```

## Build APK directly with Gradle

This avoids EAS builders entirely and generates the missing native Android project first:

```bash
set -a
source .env.local
set +a
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

Result:

```text
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Treat this as a test build unless release signing has been explicitly configured. `expo prebuild` creates the `android/` directory; review generated changes before committing anything.

## Test with Firebase Test Lab Robo test

1. Open [Firebase Console](https://console.firebase.google.com/).
2. Select the project.
3. Open **Test Lab → Android → Run a test**.
4. Choose **Robo test**.
5. Upload the APK.
6. Select virtual devices and Android versions.
7. Run the test.
8. Review screenshots, video, logs, crashes, and performance results.

Firebase provides a limited free testing quota. Robo testing is automated, not interactive.

If screenshots show the Supabase configuration error, add variables to the environment used by the build and rebuild the APK. Variables cannot be added to an existing APK.

## Free interactive testing

Use [Samsung Remote Test Lab](https://developer.samsung.com/remote-test-lab):

1. Sign in with a Samsung Developer account.
2. Reserve an available device and Android version.
3. Launch the remote device.
4. Select **Install application** and upload the APK.
5. Test the app interactively.

Free credits and device availability are limited.

Other limited-free/trial services include BrowserStack App Live and Appetize.io.

## Pre-test checks

- APK contains `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Backend URLs use public HTTPS addresses, not `localhost`.
- Test account contains no sensitive production data.
- Build uses `preview`, not `development`; development builds may require a Metro server.
