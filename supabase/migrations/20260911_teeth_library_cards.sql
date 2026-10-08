begin;
-- Lightweight, permission-filtered previews. Opening the library is not a chart
-- visit for retention; notes, histories and member addresses are never returned.
create or replace function public.teeth_library_cards(p_ids uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e text; result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view your charts' using errcode='42501'; end if;
  select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,'updatedAt',c.updated_at,'access_role',public.teeth_role(c.id),
    'delete_after',c.deleted_at+interval '30 days',
    'shared_with_people',exists(select 1 from public.teeth_chart_members m where m.chart_id=c.id),
    'preview',(select coalesce(jsonb_object_agg(a.key,jsonb_build_object(
      'status',a.value->>'status','filled',a.value->'filled','cavity',a.value->'cavity',
      'painful',a.value->'painful','wobbly',a.value->'wobbly')),'{}'::jsonb)
      from jsonb_each(c.annotations) a)
  ) order by c.updated_at desc),'[]'::jsonb) into result
  from public.teeth_charts c
  where (c.owner_id=auth.uid() or c.id=any(p_ids) or exists(
    select 1 from public.teeth_chart_members m where m.chart_id=c.id and m.email=e))
    and public.teeth_role(c.id) is not null
    and (c.deleted_at is null or c.owner_id<>auth.uid());
  return result;
end $$;
revoke all on function public.teeth_library_cards(uuid[]) from public,anon,authenticated;
grant execute on function public.teeth_library_cards(uuid[]) to authenticated;
commit;
