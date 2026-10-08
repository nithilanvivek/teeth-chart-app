-- Install after the retention migration. Secrets are entered only in Vault.
begin;
create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('teeth-chart-retention','*/5 * * * *',$job$
  select teeth_private.run_retention();
  -- Keep only a week of this job's execution logs, not an unbounded history.
  delete from cron.job_run_details where jobid=(select jobid from cron.job where jobname='teeth-chart-retention')
    and end_time<now()-interval '7 days';
$job$);
commit;
