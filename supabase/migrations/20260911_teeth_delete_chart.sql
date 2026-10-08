-- Expose deletion only to the chart owner, with a revision guard.
begin;
create or replace function public.teeth_delete_chart(p_id uuid,p_revision integer) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.teeth_charts;
begin
  select * into c from public.teeth_charts where id=p_id for update;
  if not found or auth.uid() is null or c.owner_id<>auth.uid() then raise exception 'Only the owner can delete this chart' using errcode='42501'; end if;
  if p_revision is distinct from c.revision then raise exception 'This chart changed. Reload before deleting it.' using errcode='40001'; end if;
  delete from public.teeth_charts where id=p_id;
end $$;
revoke all on function public.teeth_delete_chart(uuid,integer) from public,anon,authenticated;
grant execute on function public.teeth_delete_chart(uuid,integer) to authenticated;
commit;
