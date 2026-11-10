# Assistant voice (F9)

Voice is a separate paid add-on: both `assistant_enabled` and
`assistant_voice_enabled` must be true. All company members can use it. Both
switches are readable by members and writable only by staff SQL. Demo stays off.

Web records one utterance with MediaRecorder (tap Talk/Done talking, or pause
for 1.6 seconds; recording stops within 60 seconds). The authenticated
`assistant-voice` function transcribes audio through xAI, then the existing
`assistant-chat` function answers it. The transcript and answer appear in the
normal saved chat. Voice requests never change assistant permissions or draft
review behavior. Replies use Helix through `assistant-voice`, with browser
speech synthesis as a fallback on service/playback failure. A 403 or quota
failure ends voice and displays its message; it does not bypass the switch.

Use **Work While You Talk** in the open panel to minimize it and browse with
the Listening / Thinking / Speaking dock. Tap the dock to reopen the transcript.
End, Close, sign-out, company change, or loss of network stops voice. All mic
tracks, audio playback, object URLs, timers and speech listeners are released.

On iPhone, recognition and TTS run on the device (`expo-speech-recognition`
with `requiresOnDeviceRecognition`, `expo-speech`, and an `expo-audio` session).
An unavailable language/device or denied permission leaves text chat working.
The app stops voice in the background; neither background playback nor recording
is enabled. iPhone does not use Helix or upload recorded audio. New native modules
require a future native build; the TestFlight build already under review cannot
load them. No EAS/native build or mobile version bump is part of this change.

## Deploy later (not performed by this PR)

From the repository root, with the intended Supabase project selected:

```sh
npx supabase link --project-ref PROJECT_REF
npx supabase db push --linked --dry-run
# Review pending migrations, including 20270118000100_assistant_voice.sql.
# The existing assistant-chat migration must already be applied or precede it.
npx supabase db push --linked
# Reuse the assistant-chat secret if already configured. Otherwise load a secure
# local file containing XAI_ASSISTANT_API_KEY=<the separate assistant key>:
npx supabase secrets set --env-file /secure/path/assistant.env --project-ref PROJECT_REF
npx supabase functions deploy assistant-voice --project-ref PROJECT_REF
```

No proxy is added to Vite. The key and upstream URLs exist only in edge code.
The shared authentication helper's source change ships with `assistant-voice`;
it preserves the default JSON behavior of existing functions, which do not
need redeployment for voice. Deploy the web frontend through the normal release
process after the migration and function. Leave mobile builds on hold until
Apple review and the build hold are resolved.

Enable a company with staff SQL, replacing the UUID:

```sql
update public.companies
set assistant_enabled = true, assistant_voice_enabled = true
where id = 'COMPANY_UUID'::uuid;
```

Reload web / reopen or reconnect the mobile app to load the switches. Disable
voice alone with `set assistant_voice_enabled = false`; chat stays available.

## Limits and usage

`claim_assistant_voice(company, actor, kind)` is security definer and executable
only by `service_role`. It verifies membership and both switches and serializes
both person and company scopes with advisory locks. STT and TTS share a rolling
24-hour allowance of 200 calls per person (across companies) and 2,000 per company.
A full web turn normally claims two voice calls and one chat message. Usage logs
contain company, actor, kind and timestamp, never audio or transcripts. The edge
accepts audio MIME types only, up to 10 MB, with duration metadata up to 60 seconds;
the client bounds the recording duration. TTS accepts up to 2,000 characters.
The web speaks the first 2,000 characters of a longer answer; the whole answer
remains visible. Failed upstream attempts still consume a claim.

Device speech on iPhone consumes no upstream voice calls. Its transcripts still
consume the normal chat allowance (100/person and 1,000/company per 24 hours),
just like web voice transcripts and typed messages.

## Acceptance checks after deployment

1. Both platforms: with chat on and voice off, open the assistant and confirm
   there is no Talk microphone. An authenticated direct `assistant-voice` call
   with otherwise valid input must return 403. Voice on with chat off is also
   disabled. A user outside the company cannot call it.
2. Web over HTTPS or localhost: enable both switches, reload, tap Talk, permit
   the mic, ask “Which units are out of service?” and pause. Confirm Listening →
   Thinking → Speaking → Listening, transcript/reply in the chat, and Helix audio.
   Tap Talk while listening to finish early. Minimize via Work While You Talk,
   navigate, reopen from the dock, then End. Repeat with Close and sign-out;
   confirm the browser mic indicator and audio stop. Check light and dark themes.
3. Deny mic permission or use an unsupported browser: confirm an explanatory
   message and usable text chat. Go offline: confirm network feedback and no
   new capture. Simulate a 502 from TTS: confirm device speech fallback. Simulate
   403/429: confirm friendly feedback and no fallback around the quota.
4. In an isolated test company, seed 200 recent usage rows for a test user (or
   2,000 for the company). The next voice request must return a friendly 429.
   Age those rows past 24 hours to confirm recovery. Never seed production
   billing usage for testing.
5. iPhone, once a native build is authorized: allow microphone and speech
   permissions, Talk, ask the same question, and confirm on-device recognition,
   normal chat transcript/reply and device TTS. Denial must retain text chat.
   Background the app or close/End/sign out during each phase; confirm it stops
   and does not restart on foreground. Test a device/language without local
   speech support. Offline and normal chat daily-limit messages must be visible.

## Automated checks

```sh
npm run test --workspace=fireops-web
npm run test --workspace=@fireops/mobile
npm run test --workspace=@fireops/domain
npm run test:db-assistant
npm run typecheck
npm run build:web
# JS export only; no native build, signing, EAS, or version bump:
(cd apps/mobile && npx expo export --platform ios --output-dir /tmp/fireops-voice-ios)
# Both must produce no matches (grep/rg exits 1 when clean):
rg -l 'XAI_ASSISTANT_API_KEY|api\.x\.ai' apps/web/dist /tmp/fireops-voice-ios
```

The tests mock native speech/audio modules and cover microphone gating on both
platforms, web round trip, silence cutoff, late mic permission after End, TTS
fallback/cancellation, offline, friendly limits, native listener cleanup,
switch grants, both quotas, shared kinds, and rolling expiry. A real microphone,
xAI playback, and physical iPhone still require the acceptance checks above.
