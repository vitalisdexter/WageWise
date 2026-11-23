begin;
-- Claims now use the account Worker. Keep existing device associations as proof
-- for migration, and close the anonymous device API after the new UI is live.
revoke execute on function public.wagewise_pair(text,boolean), public.wagewise_workspace(),
 public.wagewise_read(uuid),public.wagewise_write(uuid,bigint,jsonb,uuid),
 public.wagewise_replace_code(text,uuid),public.wagewise_disconnect() from authenticated;
notify pgrst,'reload schema';
commit;
