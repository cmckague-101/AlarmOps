# Push notifications

FireOps stores every notification in a persistent inbox. Push delivery is an alerting layer over that inbox: disabling push does not remove inbox events.

## Event and copy matrix

| Event | Recipients | Title | Body | Destination |
| --- | --- | --- | --- | --- |
| Communication reply | Thread creator, prior participants, company owners | `Reply: {subject}` | `{actor} replied: {reply}` | `/communication/{threadId}` |
| Document added | All company users | `New document: {name}` | `{actor} added a company document.` | `/documents` |
| Training created | All company users | `New training: {course}` | `{code} · {date} · {location}` | `/training/{trainingId}` |
| Vehicle assigned | Assigned crew member and company owners | `Vehicle assigned: {vehicle}` | `{vehicle} was assigned to {crew member}.` | `/vehicle/{vehicleId}` |
| Issue update | Issue creator, assigned vehicle crew member, company owners | `Issue updated: {issue}` | `{actor}: {latest update}` | `/issue/{issueId}` |
| Issue resolved/reopened | Issue creator, assigned vehicle crew member, company owners | `Issue resolved/reopened: {issue}` | `{actor} resolved/reopened the issue for {vehicle}.` | `/issue/{issueId}` |

Actor never receives their own event. Recipient lists are deduplicated. Document updates, training changes, new communications, and new issues do not generate notifications.

Every event stores an entity `group_key`. Inbox groups related events under that key while preserving every row. Push payload carries same key for platform/client grouping without delaying or collapsing delivery; native notification-center layout remains OS-managed.

## Data flow

1. Database trigger derives recipients and inserts `user_notifications` rows.
2. Trigger queues enabled pushes in `push_notification_jobs`.
3. Scheduled `dispatch-push-notifications` invocation atomically claims up to 100 jobs.
4. Edge Function loads enabled Expo tokens and sends messages through Expo Push API.
5. Expo ticket IDs are stored in `push_notification_deliveries`.
6. Later invocations check receipts. `DeviceNotRegistered` disables stale tokens.
7. Failures retry with exponential backoff, capped at one hour and five claims.

Badge value comes from recipient's current unread inbox count. Opening inbox event or push marks it read and synchronizes app badge.

## Database setup

Apply migrations in order. Push support depends on:

- `supabase/migrations/20260906161500_add_push_notification_tokens.sql`
- `supabase/migrations/20260909000100_notification_inbox_and_delivery.sql`

Migration creates inbox, preferences, queue, delivery records, RLS, triggers, and service-role queue claim RPC. It does not backfill historical events.

## Edge Function setup

Generate strong dispatcher secret, then configure function secrets:

```bash
supabase secrets set PUSH_DISPATCH_SECRET="$(openssl rand -hex 32)"
# Needed only when Expo push security is enabled:
supabase secrets set EXPO_ACCESS_TOKEN="your-expo-access-token"
```

Deploy with gateway JWT verification disabled because function authenticates scheduler using `PUSH_DISPATCH_SECRET`:

```bash
supabase functions deploy dispatch-push-notifications --no-verify-jwt
```

Schedule POST request every minute using Supabase Cron or another trusted scheduler:

```text
POST https://<project-ref>.supabase.co/functions/v1/dispatch-push-notifications
x-dispatch-secret: <PUSH_DISPATCH_SECRET>
Content-Type: application/json

{}
```

Never commit dispatcher secret, service-role key, Expo access token, APNs credential, or FCM credential.

## Expo setup

Expo project and plugin live in `apps/mobile/app.json`. APNs/FCM credentials stay in EAS, not repository.

```bash
cd apps/mobile
eas credentials
```

Use production/development build on physical device. Remote push is unavailable in simulator and Expo Go. Sign-in requests OS permission automatically and registers installation token. Sign-out removes current installation token.

Payload shape:

```json
{
  "title": "Issue resolved: Pump losing pressure",
  "body": "Alex Reed resolved the issue for Engine 1.",
  "badge": 2,
  "data": {
    "path": "/issue/11111111-1111-4111-8111-111111111111",
    "notificationId": "22222222-2222-4222-8222-222222222222",
    "eventType": "issue_updated",
    "entityId": "11111111-1111-4111-8111-111111111111",
    "groupKey": "issue:11111111-1111-4111-8111-111111111111"
  }
}
```

## Preferences

Settings exposes global push and selected event toggles. Defaults are enabled. System/service notices bypass user push preferences; no current product trigger emits them. Inbox events always remain available.

## Verification

```bash
npm run typecheck
npm test

deno test supabase/functions/dispatch-push-notifications/logic.test.ts
```

After remote setup:

1. Sign into two physical-device accounts in same company.
2. Verify each selected event reaches approved recipients but not actor.
3. Tap alert and confirm destination, read state, and badge decrement.
4. Disable one event in Settings and confirm inbox entry remains but push is not queued.
5. Sign out and confirm token row is removed.
6. Inspect `push_notification_jobs` and `push_notification_deliveries` with service-role tooling for ticket/receipt state.
