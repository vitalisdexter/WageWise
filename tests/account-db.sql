-- Transactional rehearsal against the installed schema. Every fixture is rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); cred uuid:=gen_random_uuid(); device_id uuid:=gen_random_uuid(); w uuid:=gen_random_uuid();
 name text:='test-'||left(u::text,8); token text:=gen_random_uuid()::text; admin_token text:=gen_random_uuid()::text;
 code text:='WW-'||repeat('x',43); request_id uuid; data jsonb; key text:=gen_random_uuid()::text;
begin
 insert into auth.users(id,raw_app_meta_data) values (u,jsonb_build_object('ww_username',name)),
  (admin_id,jsonb_build_object('ww_username',name,'ww_role','admin')),(device_id,'{}'),(cred,jsonb_build_object('ww_recovery',u));
 if public.ww_account_api('available',jsonb_build_object('username',name))<>'false' then raise exception 'duplicate username available'; end if;
 perform public.ww_account_api('login',jsonb_build_object('id',u,'generation',0),token);
 perform public.ww_account_api('login',jsonb_build_object('id',admin_id,'generation',0),admin_token);
 insert into wagewise_private.workspaces values(w,sha256(convert_to(code,'UTF8')));
 insert into wagewise_private.devices values(device_id,w);
 insert into wagewise_private.snapshots values(w,1,'{"format":"wagewise","version":2,"calculator":{"history":[]},"log":{"days":{"2026-11-02":{}}}}',gen_random_uuid());
 data=public.ww_account_api('preview',jsonb_build_object('device',device_id),token);
 if (data->>'logDays')::int<>1 then raise exception 'missing legacy preview'; end if;
 perform public.ww_account_api('setup',jsonb_build_object('code',code),token);
 if exists(select 1 from wagewise_private.devices where device=device_id) then raise exception 'legacy pairing remains'; end if;
 begin perform public.ww_account_api('dashboard','{}',token);raise exception 'user reached dashboard'; exception when insufficient_privilege then null; end;
 perform public.ww_account_api('forgot',jsonb_build_object('username',name));
 perform public.ww_account_api('forgot',jsonb_build_object('username',name));
 select id into strict request_id from wagewise_private.resets where account=u;
 perform public.ww_account_api('session','{}',token);
 data=public.ww_account_api('dashboard',jsonb_build_object('days',7,'search',name),admin_token);
 if jsonb_array_length(data->'daily')<>7 or data#>>'{users,0,username}'<>name then raise exception 'analytics mismatch'; end if;
 perform public.ww_account_api('approve',jsonb_build_object('request',request_id,'digest',key),admin_token);
 begin perform public.ww_account_api('session','{}',token);raise exception 'old session survived'; exception when insufficient_privilege then null; end;
 begin perform public.ww_account_api('login',jsonb_build_object('id',u,'generation',0),token);raise exception 'old login survived'; exception when insufficient_privilege then null; end;
 update wagewise_private.resets set expires=now()-interval '1 second' where id=request_id;
 if public.ww_account_api('redeem',jsonb_build_object('username',name,'digest',key)) is not null then raise exception 'expired code accepted'; end if;
 perform public.ww_account_api('approve',jsonb_build_object('request',request_id,'digest',key||'2'),admin_token);
 if public.ww_account_api('redeem',jsonb_build_object('username',name,'digest',key)) is not null then raise exception 'old code accepted'; end if;
 perform public.ww_account_api('finish_reset',jsonb_build_object('username',name,'credential',cred,'digest',key||'2'));
 if public.ww_account_api('redeem',jsonb_build_object('username',name,'digest',key||'2')) is not null then raise exception 'reused code accepted'; end if;
 perform public.ww_account_api('login',jsonb_build_object('id',u,'generation',3),token);
 data=public.ww_account_api('read',jsonb_build_object('workspace',w),token);
 if (data->>'revision')::int<>1 then raise exception 'workspace lost'; end if;
end $$;
rollback;
