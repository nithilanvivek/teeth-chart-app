# Chart access notification emails

The sender is Teeth Chart App <noreply@teeth.nithi.land> for both messages:

- A verified user requests access: the chart owner receives the chart link and instructions to open Share.
- The owner approves in the automatic request popup or saves an approval in Share: the requester receives the chart link and their viewer/editor role.

Owners now see pending access requests and collaborator suggestions when opening a cloud chart. The popup allows Viewer/Editor approval or dismissal; empty queues never open it. It uses the existing permission-checked RPCs and email queue, and runs after chart loading.

Direct email additions and dismissed requests do not send approval mail. Existing pending requests are queued when the migration is installed. Owner request notifications include the verified requester email. They do not include chart content or other collaborators’ identities.

## Setup

Apply `20260911_teeth_access_emails.sql`, then `20260911_teeth_access_email_schedule.sql`, followed by `20260911_teeth_requester_email.sql`. In Supabase Vault, save the existing Resend SMTP/API key as `teeth_resend_api_key`. It must allow sending from teeth.nithi.land. SMTP settings for login emails remain unchanged; a new sender/domain is not needed. The same Vault secret also enables the previously installed inactivity-warning worker.

The private queue is written transactionally with requests/approvals. A cron job runs every minute, sends up to five messages, and retries unsuccessful sends after five minutes. It cancels stale grants, deleted charts and changed recipient addresses before sending. Provider idempotency keys and fixed payloads cover retries within Resend’s 24-hour window; retries stop after 23 hours from the first attempt. Unsent events expire after seven days. Completed queue records and scheduler logs are pruned after seven days. A send receipt means provider acceptance, not guaranteed inbox delivery.

No browser API can write/read the queue or invoke the worker. Provider response bodies, keys and message payloads are not written to error logs.

## Read-only operational check

```sql
select exists(select 1 from vault.secrets where name='teeth_resend_api_key') as email_key_present;
select kind, count(*) filter(where finished_at is null) as pending,
  count(*) filter(where provider_id is not null) as accepted,
  count(*) filter(where finished_at is not null and provider_id is null) as stopped
from teeth_private.access_emails group by kind;
select jobname,schedule,active from cron.job where jobname='teeth-access-emails';
```

Provider reference: https://resend.com/docs/dashboard/emails/idempotency-keys

## Production status

Both migrations are installed. On 11 September 2026 the user configured the Vault
key and confirmed that the queued owner notification arrived.
