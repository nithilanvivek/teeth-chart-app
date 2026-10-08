-- Run after the copy-window migration. Access expires at exactly 30 days;
-- this daily job removes the expired rows and their dependent records.
begin;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('teeth-deleted-chart-purge','17 2 * * *',$job$
 select teeth_private.purge_deleted_charts();
 delete from cron.job_run_details where jobid=(select jobid from cron.job where jobname='teeth-deleted-chart-purge') and end_time<now()-interval '7 days';
$job$);
commit;
