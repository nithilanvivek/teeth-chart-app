-- Deletion metadata excludes annotations/history and does not count as a view.
begin;
create or replace function public.teeth_delete_info(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  if auth.uid() is null then raise exception 'Sign in to delete a cloud chart' using errcode='42501'; end if;
  select id,name,revision,owner_id into c from public.teeth_charts where id=p_id;
  if not found then return null; end if;
  if c.owner_id<>auth.uid() then raise exception 'Only the owner can delete this chart' using errcode='42501'; end if;
  return jsonb_build_object('id',c.id,'name',c.name,'revision',c.revision);
end $$;
revoke all on function public.teeth_delete_info(uuid) from public,anon,authenticated;
grant execute on function public.teeth_delete_info(uuid) to authenticated;

-- A retry after a lost success response is harmless. Existing charts still
-- require ownership and the exact revision confirmed by the owner.
create or replace function public.teeth_delete_chart(p_id uuid,p_revision integer) returns void
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  if auth.uid() is null then raise exception 'Sign in to delete a cloud chart' using errcode='42501'; end if;
  select owner_id,revision into c from public.teeth_charts where id=p_id for update;
  if not found then return; end if;
  if c.owner_id<>auth.uid() then raise exception 'Only the owner can delete this chart' using errcode='42501'; end if;
  if p_revision is distinct from c.revision then raise exception 'This chart changed. Confirm deletion of the latest version.' using errcode='40001'; end if;
  delete from public.teeth_charts where id=p_id;
end $$;
revoke all on function public.teeth_delete_chart(uuid,integer) from public,anon,authenticated;
grant execute on function public.teeth_delete_chart(uuid,integer) to authenticated;
commit;
