# FireOps Assistant (Grok chat)

The flame mascot button opens the FireOps Assistant, a text chat on web and
mobile. The separate [voice add-on](assistant-voice-setup.md) adds microphone
input and spoken replies. It answers through the `assistant-chat` edge
function, which holds `XAI_ASSISTANT_API_KEY`; web and mobile never see the key.

- **Who:** every member of a company that has the add-on
  (`companies.assistant_enabled`). Not shown in demo mode.
- **What it does:**
  - Explains where things are and how to use them, with an "Open …" button to
    the screen. Screens are shared route ids (`ASSISTANT_ROUTE_IDS` in
    `packages/domain/src/assistant.ts`, mirrored in
    `supabase/functions/assistant-chat/logic.ts`; a test checks both lists and
    the role rules match). Web and mobile each map an id to their own route and
    hide screens the user's role cannot open.
  - Answers questions about company data: units by status (for example out of
    service), open fleet issues, expired or expiring qualifications and
    RT-130/WCT records, unpaid and overdue invoices, and the user's own tasks.
  - Prepares drafts for review (level B): **Scan invoice photo** (or **Open new
    invoice** when auto-fill is off), **Add receipt photos**, and **Review task**
    (owners, admins and shop techs). Each one opens the existing form; invoice
    and receipt photos go through the normal auto-fill flow. Nothing is saved
    or submitted until the user does it.
- **Read-only, with the caller's permissions:** data questions run fixed,
  read-only queries with the caller's own session (their JWT and the anon key),
  so row-level security decides what they see. For example, crew members only
  see invoices they created, and Resource Bosses (no Roster) only get their own
  qualifications. The service role is used only to verify the caller, look up
  their role and claim usage.
- **Guardrails in the system prompt:** brief answers; never claims to have
  saved or changed anything; only states facts the tools returned; no legal,
  medical or payroll tax advice; stays on FireOps and wildland fire work.
- **History:** chats are saved on the device only (web `localStorage`, mobile
  SQLite), separately per user and company, up to 30 chats. Nothing is stored
  on the server, so owners cannot read staff chats. The last 12 messages of the
  open chat are sent with each new message as context.
- **Offline:** the button stays visible with a no-signal badge, and the chat
  says "The assistant needs a network connection."

## Deploy

1. Apply migration `20270116000100_assistant_chat.sql` (adds
   `companies.assistant_enabled`, `assistant_chat_usage` and
   `claim_assistant_chat`).
2. Create a separate API key in the xAI console (for example named
   "FireOps Assistant") so its usage and cost show apart from auto-fill, which
   keeps `XAI_API_KEY`. The assistant does not fall back to `XAI_API_KEY`;
   without its own key it answers "The assistant is not configured."

   ```sh
   npx supabase secrets set XAI_ASSISTANT_API_KEY="xai-..."
   npx supabase functions deploy assistant-chat
   # optional, defaults to grok-4.7; must support tool (function) calling
   npx supabase secrets set XAI_ASSISTANT_MODEL="grok-4.7"
   ```

   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
   provided by Supabase automatically.
3. Web ships with the next Vercel deploy. Mobile needs a new store build
   (there are no over-the-air updates).

## Turn it on for a company

This is a paid add-on, separate from receipt/invoice auto-fill:

```sql
update public.companies set assistant_enabled = true where company_code = 'ABC-123';
```

## Limits and usage

100 messages per person and 1,000 per company in any rolling 24 hours. One
message is one claim, even when Grok makes several tool calls to answer it.
Every allowed message is logged in `assistant_chat_usage`:

```sql
select c.name, count(*) as messages, count(distinct u.user_id) as people
from public.assistant_chat_usage u join public.companies c on c.id = u.company_id
where u.created_at >= date_trunc('month', now())
group by c.name order by messages desc;
```

The log has no message text.
