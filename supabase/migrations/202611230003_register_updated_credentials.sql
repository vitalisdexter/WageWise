begin;
-- Auth can add app_metadata after inserting the user. Claim the username
-- on that first metadata update as well as on creation.
create trigger wagewise_account_metadata_added
after update of raw_app_meta_data on auth.users
for each row
when (new.raw_app_meta_data ? 'ww_username'
      and not coalesce(old.raw_app_meta_data ? 'ww_username', false))
execute function wagewise_private.account_created();
commit;
