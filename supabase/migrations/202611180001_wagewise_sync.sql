begin;

create schema wagewise_private;
revoke all on schema wagewise_private from public;

create table wagewise_private.workspaces (
    id uuid primary key default gen_random_uuid(),
    code_hash bytea not null unique
);

create table wagewise_private.devices (
    device uuid primary key references auth.users(id) on delete cascade,
    workspace uuid not null references wagewise_private.workspaces(id) on delete cascade
);

create table wagewise_private.snapshots (
    workspace uuid primary key references wagewise_private.workspaces(id) on delete cascade,
    revision bigint not null check (revision > 0),
    data jsonb not null,
    mutation uuid not null,
    check (octet_length(data::text) <= 5242880)
);

alter table wagewise_private.workspaces enable row level security;
alter table wagewise_private.devices enable row level security;
alter table wagewise_private.snapshots enable row level security;

create function wagewise_private.current_workspace()
returns uuid
language sql stable security definer set search_path = ''
as $$
    select workspace from wagewise_private.devices where device = auth.uid()
$$;

create function public.wagewise_workspace()
returns uuid
language sql stable security definer set search_path = ''
as $$
    select wagewise_private.current_workspace()
$$;

create function public.wagewise_pair(pairing_code text, create_workspace boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    current_device uuid := auth.uid();
    workspace_id uuid;
    secret_hash bytea;
begin
    if current_device is null or create_workspace is null or pairing_code is null
        or pairing_code !~ '^WW-[a-zA-Z0-9_-]{43}$' then
        raise exception 'Enter a valid WageWise pairing code.' using errcode = '22023';
    end if;
    secret_hash := sha256(convert_to(pairing_code, 'UTF8'));
    -- Serialize link changes for a single device.
    perform pg_advisory_xact_lock(hashtextextended(current_device::text, 0));
    if create_workspace then
        if wagewise_private.current_workspace() is not null then
            raise exception 'Disconnect this device before creating another pairing code.' using errcode = '22023';
        end if;
        insert into wagewise_private.workspaces (code_hash) values (secret_hash) returning id into workspace_id;
    else
        select id into workspace_id from wagewise_private.workspaces where code_hash = secret_hash;
        if workspace_id is null then
            raise exception 'That pairing code was not found.' using errcode = '22023';
        end if;
    end if;
    insert into wagewise_private.devices (device, workspace) values (current_device, workspace_id)
    on conflict (device) do update set workspace = excluded.workspace;
    return workspace_id;
end
$$;

create function public.wagewise_disconnect()
returns void
language sql security definer set search_path = ''
as $$
    delete from wagewise_private.devices where device = auth.uid()
$$;

create function public.wagewise_replace_code(pairing_code text, expected_workspace uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare workspace_id uuid := wagewise_private.current_workspace();
begin
    if workspace_id is null or expected_workspace is distinct from workspace_id then
        raise exception 'WageWise pairing changed.' using errcode = '42501';
    end if;
    if pairing_code is null or pairing_code !~ '^WW-[a-zA-Z0-9_-]{43}$' then
        raise exception 'Invalid pairing code.' using errcode = '22023';
    end if;
    update wagewise_private.workspaces set code_hash = sha256(convert_to(pairing_code, 'UTF8'))
    where id = workspace_id;
end
$$;

create function public.wagewise_read(expected_workspace uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare workspace_id uuid := wagewise_private.current_workspace();
begin
    if workspace_id is null or expected_workspace is distinct from workspace_id then
        raise exception 'WageWise pairing changed.' using errcode = '42501';
    end if;
    return (select jsonb_build_object('revision', revision, 'data', data)
        from wagewise_private.snapshots where workspace = workspace_id);
end
$$;

create function public.wagewise_write(expected_workspace uuid, expected_revision bigint, snapshot jsonb, mutation_id uuid)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
    workspace_id uuid := wagewise_private.current_workspace();
    saved_revision bigint;
begin
    if workspace_id is null or expected_workspace is distinct from workspace_id then
        raise exception 'WageWise pairing changed.' using errcode = '42501';
    end if;
    if expected_revision is null or expected_revision < 0 or mutation_id is null
        or coalesce((snapshot ->> 'format' = 'wagewise') and (snapshot -> 'version' = '2'::jsonb)
            and jsonb_typeof(snapshot -> 'log') = 'object'
            and jsonb_typeof(snapshot -> 'calculator') in ('object', 'null'), false) = false then
        raise exception 'Invalid WageWise snapshot.' using errcode = '22023';
    end if;

    if expected_revision = 0 then
        insert into wagewise_private.snapshots (workspace, revision, data, mutation)
        values (workspace_id, 1, snapshot, mutation_id) on conflict (workspace) do nothing
        returning revision into saved_revision;
    else
        update wagewise_private.snapshots set revision = revision + 1, data = snapshot, mutation = mutation_id
        where workspace = workspace_id and revision = expected_revision
        returning revision into saved_revision;
    end if;

    if saved_revision is null then
        select revision into saved_revision from wagewise_private.snapshots
        where workspace = workspace_id and mutation = mutation_id;
    end if;
    return saved_revision;
end
$$;

revoke all on function public.wagewise_workspace(), public.wagewise_pair(text, boolean),
    public.wagewise_disconnect(), public.wagewise_replace_code(text, uuid), public.wagewise_read(uuid),
    public.wagewise_write(uuid, bigint, jsonb, uuid) from public, anon;
grant execute on function public.wagewise_workspace(), public.wagewise_pair(text, boolean),
    public.wagewise_disconnect(), public.wagewise_replace_code(text, uuid), public.wagewise_read(uuid),
    public.wagewise_write(uuid, bigint, jsonb, uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
