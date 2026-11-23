begin;
create function public.ww_admin_reset(sid text, username_input text, code_digest text)
returns void language plpgsql security definer set search_path='' as $$
declare target uuid; ticket uuid;
begin
 if not (public.ww_account_api('session','{}',sid)->>'admin')::boolean then
   raise insufficient_privilege;
 end if;
 select id into strict target from wagewise_private.accounts where username=username_input and not admin for update;
 insert into wagewise_private.resets(account,state) values(target,'pending')
   on conflict do nothing returning id into ticket;
 if ticket is null then
   select id into strict ticket from wagewise_private.resets where account=target and state in ('pending','approved');
 end if;
 perform public.ww_account_api('approve',jsonb_build_object('request',ticket,'digest',code_digest),sid);
end $$;
revoke all on function public.ww_admin_reset(text,text,text) from public,anon,authenticated;
grant execute on function public.ww_admin_reset(text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
