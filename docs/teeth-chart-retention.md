# Cloud chart inactivity retention

A successful authorized open, save, or sharing update records `last_viewed_at`.
Library listings and rejected access attempts do not. Public-link views count when
the sharing policy permits them. Visits do not change a chart's content revision.
Browser-only charts are outside this policy.

After twelve calendar months without a view, a scheduled Supabase job emails the
owner's current verified address. It contains a direct `https://nithi.land/t/UUID`
link and explains that opening the chart prevents deletion. Chart names, notes,
and annotations are not included in the email.

The four-week grace period begins only after Resend accepts the warning. The job
then deletes the chart, history, sharing members, and access requests if it remains
inactive for all 28 days. Opening the chart cancels any pending warning/deletion,
including a warning whose email has just been sent. An owner email change invalidates an old
warning; a new warning must be sent to the current verified address.

Existing charts start a fresh twelve-month period when view tracking is installed,
because earlier view times were not recorded. This prevents retroactive deletion.

## Installation

1. Apply all previous Teeth Chart migrations, then
   `supabase/migrations/20260911_teeth_retention.sql`.
2. In Supabase Vault add `teeth_resend_api_key`. Its value is a Resend sending API
   key authorized for the verified domain `teeth.nithi.land`. The configured sender
   is `Teeth Chart App <noreply@teeth.nithi.land>`. Never put the key in a migration,
   browser code, a committed environment file, or a screenshot.
3. Apply `supabase/migrations/20260911_teeth_retention_schedule.sql`, enabling
   the HTTP extension and pg_cron and scheduling one run every five minutes. Running this
   migration again updates the same named job rather than making a duplicate.

The worker is private and unavailable to browser roles. Its bounded, synchronous
HTTP request keeps the API key out of shared transport queue tables. Missing credentials pause
all processing. Quota, network, malformed-response, and other send failures retry
later and cannot start deletion. Only one warning is attempted per run to avoid
bursts. Resend idempotency keys prevent duplicate sends during its 24-hour retry
window. An uncertain send retried beyond that window can cause a duplicate warning, but never
an earlier deletion: a new positive receipt starts a full grace period.

An accepted send is not a guarantee of inbox delivery (for example, a recipient
mail server may subsequently reject it). Monitor Resend delivery/bounce reports.
Job delays, quota exhaustion, or a paused Supabase project postpone processing;
they do not shorten the owner's grace period. A week of this job's execution logs
is retained to keep scheduler history bounded.

## Check configuration without exposing secrets

Run in the Supabase SQL Editor as the project administrator:

```sql
select exists(select 1 from vault.secrets where name='teeth_resend_api_key') as email_key_present;
select jobname,schedule,active from cron.job where jobname='teeth-chart-retention';
select status,return_message,start_time,end_time from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='teeth-chart-retention')
order by start_time desc limit 5;
select count(*) filter(where warned_at is null) as awaiting_send,
       count(*) filter(where warned_at is not null) as warned
from teeth_private.retention_notices;
```

To pause this feature without affecting login or charts:

```sql
select cron.alter_job(jobid,active:=false)
from cron.job where jobname='teeth-chart-retention';
```

Do not backdate real charts to test this feature. `npm run test:charts` runs its
Postgres integration tests in PGlite with mocked email transport and disposable
data, including expiry, send failures, visits, changed addresses, and permissions.

Implementation references: [Supabase Cron](https://supabase.com/docs/guides/cron),
[HTTP extension](https://supabase.com/docs/guides/database/extensions/http),
[Vault](https://supabase.com/docs/guides/database/vault), and
[Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
