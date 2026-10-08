-- Account deletion is self-service only. No caller-supplied user ID is accepted.
begin;
create or replace function public.teeth_delete_account(p_confirm_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare user_id uuid:=auth.uid(); account_email text;
begin
  if user_id is null then raise exception 'Sign in to delete your account' using errcode='42501'; end if;
  select lower(email) into account_email from auth.users where id=user_id for update;
  -- A lost success response may be retried with the same still-valid JWT.
  if not found then return; end if;
  if p_confirm_email is null or lower(trim(p_confirm_email)) is distinct from account_email then
    raise exception 'Enter your signed-in email to confirm account deletion' using errcode='22023';
  end if;
  -- Remove this identity's named access without changing anyone else's grants.
  -- Revision changes prevent a stale Share dialog from restoring removed access.
  update public.teeth_charts set revision=revision+1,updated_at=now()
    where owner_id<>user_id and id in (select chart_id from public.teeth_chart_members where email=account_email);
  delete from public.teeth_chart_members where email=account_email;
  -- Owned charts, their histories/sharing/requests/retention notices, and this
  -- user's auth sessions and access requests are removed by their foreign keys.
  delete from auth.users where id=user_id;
end $$;
revoke all on function public.teeth_delete_account(text) from public,anon,authenticated;
grant execute on function public.teeth_delete_account(text) to authenticated;
commit;
