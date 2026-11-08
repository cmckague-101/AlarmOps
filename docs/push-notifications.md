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
| Task due | Task owner only (owner/admin/shop tech) | `Task due today: {subject}` | `Your task is due today. Open Task List to review or complete it.` | `/tasks` |

Crew Chat “Joined the conversation.” replies still appear in the thread so the member becomes a participant, but they do not create inbox or push notifications.

Task reminders are scheduled events with no actor; they notify only the task owner. For user-generated events, actor never receives their own event. Recipient lists are deduplicated. Document updates, training changes, new communications, and new issues do not generate notifications.

Every event stores an entity `group_key`. Inbox groups related events under that key while preserving every row. Push payload carries same key for platform/client grouping without delaying or collapsing delivery; native notification-center layout remains OS-managed.

## Data flow

1. Database trigger derives recipients and inserts `user_notifications` rows.
2. Trigger queues enabled pushes in `push_notification_jobs`.
3. Scheduled `dispatch-push-notifications` invocation first queues due task reminders, then atomically claims up to 100 jobs.
4. Edge Function loads enabled Expo tokens and sends messages through Expo Push API.
5. Expo ticket IDs are stored in `push_notification_deliveries`.
6. Later invocations check receipts. `DeviceNotRegistered` disables stale tokens.
7. Failures retry with exponential backoff, capped at one hour and five claims.

Badge value comes from recipient's current unread inbox count. Opening inbox event or push marks it read and synchronizes app badge.

Users can clear notifications (swipe left or **Clear all**, web dashboard and mobile inbox). Clearing sets `dismissed_at` through `dismiss_user_notifications` (`20270104000200_dismiss_user_notifications.sql`) and also marks the notification read, so it disappears on every device and drops out of unread and badge counts. Rows are kept for delivery history. Clear all only clears the event types that screen lists. Mobile clears made offline stay hidden on that device and are sent on the next online refresh.

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

## Task reminders (9 AM)

Apply `supabase/migrations/20261229000100_task_due_reminders.sql`, then redeploy `dispatch-push-notifications`. The existing authenticated every-minute scheduler drives reminders; no new cron job is needed if that schedule is already configured. Until migration, function deployment and scheduler are active, reminders are not delivered.

Opening Task List online on web or mobile saves that account/company's current IANA timezone through `set_task_reminder_timezone`. Last online Task List visit wins across devices. Existing tasks are included, but no timezone is guessed for users who have not opened Task List online since this update. Daylight-saving changes use the zone's calendar rules.

Each task gets one reminder per due date, at the first scheduler invocation at/after 9 AM on that local date. Delays and tasks created/synced later that same day catch up; historical overdue tasks do not generate a backlog. Up to 1,000 reminders are queued per invocation. Completion, rescheduling or loss of task access cancels queued pushes not yet claimed. Already-delivered inbox history remains. Offline-only changes cannot affect reminders until synced. In-flight pushes cannot be recalled.

Reminders honor global push preferences both at queue and claim time; they remain in the inbox even when push is disabled. Installed mobile app receives Expo push (including while closed, subject to OS/network delivery); web shows reminders in dashboard Notifications, not browser OS push. Tapping opens Task List. No separate per-task switch is required.

Targeted database checks: `node --test supabase/tests/task-due-reminders.test.mjs`.

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
