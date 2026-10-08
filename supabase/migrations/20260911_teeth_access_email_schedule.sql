begin;
create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('teeth-access-emails','* * * * *',$job$
  select teeth_private.send_access_emails();
  delete from cron.job_run_details where jobid=(select jobid from cron.job where jobname='teeth-access-emails') and end_time<now()-interval '7 days';
$job$);
commit;
