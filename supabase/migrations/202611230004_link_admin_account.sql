begin;

-- A linked administrator shares the member's credential, but still signs in
-- separately and receives a session that cannot open personal workspaces.
alter table wagewise_private.accounts
  alter column credential drop not null,
  add column admin_source uuid unique references wagewise_private.accounts on delete cascade,
  add constraint account_credential_source check (
    (credential is not null and admin_source is null) or
    (admin and credential is null and admin_source is not null and admin_source <> id)
  );

alter function public.ww_account_api(text,jsonb,text) rename to ww_account_core;
revoke execute on function public.ww_account_core(text,jsonb,text) from service_role;

create function public.ww_account_api(op text, p jsonb default '{}', sid text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare linked wagewise_private.accounts; source wagewise_private.accounts; result jsonb;
begin
  if op='lookup' and p->>'admin'='true' then
    select * into linked from wagewise_private.accounts
      where admin and username=p->>'username' and admin_source is not null;
    if found then
      select * into strict source from wagewise_private.accounts where id=linked.admin_source and not admin;
      return jsonb_build_object(
        'id',linked.id,'credential',source.credential,'generation',source.generation,'locked',source.locked,
        'email',(select email from auth.users where id=source.credential)
      );
    end if;
  elsif op='login' then
    select * into linked from wagewise_private.accounts where id=(p->>'id')::uuid and admin_source is not null;
    if found then
      -- Lock the member first, matching password changes that revoke admin sessions.
      select * into source from wagewise_private.accounts where id=linked.admin_source and not admin
        and generation=(p->>'generation')::bigint and not locked for share;
      if not found then raise insufficient_privilege; end if;
      p=p||jsonb_build_object('generation',linked.generation);
    end if;
  elsif op='approve' and exists (
    select 1 from wagewise_private.resets r join wagewise_private.accounts a on a.admin_source=r.account
    where r.id=(p->>'request')::uuid
  ) then
    -- An inbox reset would lock the credentials needed to finish the reset.
    raise exception 'Linked administrator account';
  end if;

  result=public.ww_account_core(op,p,sid);
  if op in ('login','session') and result->>'admin'='false' then
    result=result||jsonb_build_object('canAdmin',exists(
      select 1 from wagewise_private.accounts where admin_source=(result->>'id')::uuid
    ));
  end if;
  return result;
end $$;
revoke all on function public.ww_account_api(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ww_account_api(text,jsonb,text) to service_role;

create function wagewise_private.revoke_linked_admin_sessions() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from wagewise_private.sessions s using wagewise_private.accounts a
    where a.admin_source=new.id and s.account=a.id;
  return new;
end $$;
create trigger wagewise_linked_admin_password_changed after update of generation on wagewise_private.accounts
for each row when (old.generation is distinct from new.generation)
execute function wagewise_private.revoke_linked_admin_sessions();

notify pgrst,'reload schema';
commit;
