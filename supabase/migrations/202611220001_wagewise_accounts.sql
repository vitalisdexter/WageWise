begin;
create table wagewise_private.accounts (
 id uuid primary key, credential uuid not null unique references auth.users on delete restrict,
 username text not null check (username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'),
 admin boolean not null default false, unique(username,admin),
 workspace uuid unique references wagewise_private.workspaces,
 generation bigint not null default 0, locked boolean not null default false,
 created_at timestamptz not null default now()
);
create table wagewise_private.sessions (
 digest text primary key, account uuid not null references wagewise_private.accounts on delete cascade,
 expires timestamptz not null
);
create index on wagewise_private.sessions(account);
create table wagewise_private.resets (
 id uuid primary key default gen_random_uuid(), account uuid not null references wagewise_private.accounts on delete cascade,
 state text not null check(state in ('pending','approved','declined','completed')),
 requested timestamptz not null default now(), digest text, expires timestamptz
);
create unique index on wagewise_private.resets(account) where state in ('pending','approved');
create table wagewise_private.actions (
 id bigint generated always as identity primary key, account uuid references wagewise_private.accounts on delete cascade,
 actor uuid references wagewise_private.accounts on delete set null, action text not null, at timestamptz not null default now()
);
create index on wagewise_private.actions(action,at);
create table wagewise_private.usage_days (
 account uuid references wagewise_private.accounts on delete cascade, day date not null, primary key(account,day)
);
create index on wagewise_private.usage_days(day);
create table wagewise_private.attempts (key text primary key, since timestamptz not null, hits integer not null);
create index on wagewise_private.attempts(since);
-- GoTrue creates the account and reserves its username in the same transaction.
-- Only the privileged Auth API can set app_metadata; user_metadata is never trusted.
create function wagewise_private.account_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.raw_app_meta_data ? 'ww_username' then
   insert into wagewise_private.accounts(id,credential,username,admin) values
    (new.id,new.id,new.raw_app_meta_data->>'ww_username',coalesce(new.raw_app_meta_data->>'ww_role','')='admin');
 end if;
 return new;
end $$;
create trigger wagewise_account_created after insert on auth.users for each row execute function wagewise_private.account_created();

create or replace function wagewise_private.current_workspace() returns uuid language sql stable security definer set search_path='' as $$
 select d.workspace from wagewise_private.devices d where d.device=auth.uid()
 and not exists(select 1 from wagewise_private.accounts a where a.workspace=d.workspace)
$$;

create function public.ww_account_api(op text, p jsonb default '{}', sid text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a wagewise_private.accounts; target wagewise_private.accounts; r wagewise_private.resets;
 w uuid; n bigint; rev bigint; value jsonb; descriptor jsonb; today date := (now() at time zone 'utc')::date;
begin
 if op='limit' then
   delete from wagewise_private.attempts where since<now()-interval '1 day';
   insert into wagewise_private.attempts as t values(p->>'key',now(),1)
   on conflict(key) do update set hits=case when t.since<now()-interval '15 min' then 1 else t.hits+1 end,
     since=case when t.since<now()-interval '15 min' then now() else t.since end returning hits into n;
   return to_jsonb(n<=(p->>'max')::int);
 elsif op='lookup' then
   select aa.* into a from wagewise_private.accounts aa where aa.username=p->>'username' and aa.admin=(p->>'admin')::boolean;
   if a.id is null then return null; end if;
   return jsonb_build_object('id',a.id,'credential',a.credential,'email',(select email from auth.users where id=a.credential),'generation',a.generation,'locked',a.locked);
 elsif op='available' then
   return to_jsonb(not exists(select 1 from wagewise_private.accounts where username=p->>'username' and not admin));
 elsif op='admin_ready' then
   return to_jsonb(exists(select 1 from wagewise_private.accounts where admin));
 elsif op='login' then
   select * into a from wagewise_private.accounts where id=(p->>'id')::uuid and generation=(p->>'generation')::bigint and not locked for share;
   if a.id is null then raise insufficient_privilege; end if;
   delete from wagewise_private.sessions where expires<now();
   insert into wagewise_private.sessions values(sid,a.id,now()+case when a.admin then interval '8 hours' else interval '14 days' end);
   insert into wagewise_private.actions(account,action) values(a.id,'login');
 elsif op='forgot' then
   insert into wagewise_private.resets(account,state) select id,'pending' from wagewise_private.accounts
     where username=p->>'username' and not admin on conflict do nothing;
   return 'true';
 elsif op='finish_reset' then
   select * into a from wagewise_private.accounts where username=p->>'username' and not admin and locked for update;
   if a.id is null or not exists(select 1 from auth.users where id=(p->>'credential')::uuid and raw_app_meta_data->>'ww_recovery'=a.id::text) then raise insufficient_privilege; end if;
   update wagewise_private.resets set state='completed',digest=null,expires=null where account=a.id and state='approved' and digest=p->>'digest' and expires>clock_timestamp();
   if not found then raise insufficient_privilege; end if;
   update wagewise_private.accounts set locked=false,credential=(p->>'credential')::uuid,generation=generation+1 where id=a.id;
   insert into wagewise_private.actions(account,action) values(a.id,'completed');
   return to_jsonb(a.credential);
 elsif op='redeem' then
   select aa.id into w from wagewise_private.accounts aa join wagewise_private.resets rr on rr.account=aa.id
    where aa.username=p->>'username' and not aa.admin and aa.locked and rr.state='approved'
      and rr.digest=p->>'digest' and rr.expires>now();
   return to_jsonb(w);
 else
   select aa.* into a from wagewise_private.sessions s join wagewise_private.accounts aa on aa.id=s.account
     where s.digest=sid and s.expires>now() and not aa.locked for share of aa;
   if a.id is null then raise insufficient_privilege; end if;
 end if;
 descriptor=jsonb_build_object('id',a.id,'username',a.username,'admin',a.admin,'workspace',a.workspace);
 if op in ('login','session') then
   if not a.admin then insert into wagewise_private.usage_days values(a.id,today) on conflict do nothing; end if;
   return descriptor;
 elsif op='logout' then delete from wagewise_private.sessions where digest=sid; return 'true';
 elsif op in ('dashboard','approve','decline') then
   if not a.admin then raise insufficient_privilege; end if;
   if op='dashboard' then
     n=case when p->>'days'='7' then 7 else 30 end;
     return jsonb_build_object(
       'total',(select count(*) from wagewise_private.accounts where not admin),
       'pending',(select count(*) from wagewise_private.resets where state='pending'),
       'active',(select count(distinct account) from wagewise_private.usage_days where day>today-n::int),
       'daily',(select jsonb_agg(jsonb_build_object('day',dt,'registrations',(select count(*) from wagewise_private.accounts where not admin and (created_at at time zone 'utc')::date=dt),
          'logins',(select count(*) from wagewise_private.actions ac join wagewise_private.accounts aa on aa.id=ac.account where not aa.admin and ac.action='login' and (ac.at at time zone 'utc')::date=dt)) order by dt)
          from (select today-i as dt from generate_series(0,n::int-1) i) d),
       'users',(select coalesce(jsonb_agg(to_jsonb(u)),'[]') from (select username,created_at,locked from wagewise_private.accounts where not admin and position(lower(coalesce(p->>'search','')) in username)>0 order by username limit 100 offset greatest(0,coalesce((p->>'offset')::int,0))) u),
       'requests',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select rr.id,aa.username,rr.state,rr.requested,rr.expires from wagewise_private.resets rr join wagewise_private.accounts aa on aa.id=rr.account where rr.state in ('pending','approved') order by rr.requested limit 100 offset greatest(0,coalesce((p->>'inboxOffset')::int,0))) q),
       'audit',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from (select aa.username,ac.action,ac.at,ad.username as actor from wagewise_private.actions ac join wagewise_private.accounts aa on aa.id=ac.account left join wagewise_private.accounts ad on ad.id=ac.actor where ac.action<>'login' order by ac.id desc limit 100) h));
   end if;
   select aa.* into target from wagewise_private.accounts aa join wagewise_private.resets rr on rr.account=aa.id where rr.id=(p->>'request')::uuid and not aa.admin for update of aa;
   select * into r from wagewise_private.resets where id=(p->>'request')::uuid for update;
   if target.id is null or r.state not in ('pending','approved') then raise exception 'Request closed'; end if;
   if op='approve' then
     update wagewise_private.accounts set locked=true,generation=generation+1 where id=target.id;
     delete from wagewise_private.sessions where account=target.id;
     update wagewise_private.resets set state='approved',digest=p->>'digest',expires=now()+interval '30 min' where id=r.id;
   else
     if r.state<>'pending' then raise exception 'Already approved'; end if;
     update wagewise_private.resets set state='declined' where id=r.id;
   end if;
   insert into wagewise_private.actions(account,actor,action) values(target.id,a.id,case when op='approve' then 'approved' else 'declined' end);
   return 'true';
 end if;
 if a.admin then raise insufficient_privilege; end if;
 if op in ('setup','preview') then
   if a.workspace is not null then return descriptor; end if;
   if p ? 'code' then
     select id into w from wagewise_private.workspaces where code_hash=sha256(convert_to(p->>'code','UTF8')) for update;
   elsif p ? 'device' then
     select ws.id into w from wagewise_private.workspaces ws join wagewise_private.devices d on d.workspace=ws.id where d.device=(p->>'device')::uuid for update of ws,d;
   elsif op='setup' then
     insert into wagewise_private.workspaces(code_hash) values(sha256(convert_to(gen_random_uuid()::text,'UTF8'))) returning id into w;
   end if;
   if w is null or exists(select 1 from wagewise_private.accounts where workspace=w) then raise exception 'Workspace unavailable'; end if;
   if op='preview' then
     select data into value from wagewise_private.snapshots where workspace=w;
     return jsonb_build_object('workspace',w,'payEntries',coalesce(jsonb_array_length(value#>'{calculator,history}'),0),
       'logDays',(select count(*) from jsonb_object_keys(coalesce(value#>'{log,days}','{}'))));
   end if;
   update wagewise_private.accounts set workspace=w where id=a.id and workspace is null;
   if not found then raise exception 'Workspace already selected'; end if;
   update wagewise_private.workspaces set code_hash=sha256(convert_to(gen_random_uuid()::text,'UTF8')) where id=w;
   delete from wagewise_private.devices where workspace=w;
   return descriptor||jsonb_build_object('workspace',w);
 end if;
 if a.workspace is null or a.workspace is distinct from (p->>'workspace')::uuid then raise insufficient_privilege; end if;
 if op='read' then
   return (select jsonb_build_object('revision',revision,'data',data) from wagewise_private.snapshots where workspace=a.workspace);
 elsif op='write' then
   value=p->'snapshot';
   if value is null or value->>'format' is distinct from 'wagewise' or value->>'version' is distinct from '2' or jsonb_typeof(value->'log') is distinct from 'object' or coalesce(jsonb_typeof(value->'calculator'),'') not in ('object','null') then raise exception 'Invalid snapshot'; end if;
   if (p->>'revision')::bigint=0 then
     insert into wagewise_private.snapshots values(a.workspace,1,value,(p->>'mutation')::uuid) on conflict do nothing returning revision into rev;
   else
     update wagewise_private.snapshots set revision=revision+1,data=value,mutation=(p->>'mutation')::uuid where workspace=a.workspace and revision=(p->>'revision')::bigint returning revision into rev;
   end if;
   if rev is null then select revision into rev from wagewise_private.snapshots where workspace=a.workspace and mutation=(p->>'mutation')::uuid; end if;
   return to_jsonb(rev);
 end if;
 raise exception 'Unknown operation';
end $$;
revoke all on function public.ww_account_api(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ww_account_api(text,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
