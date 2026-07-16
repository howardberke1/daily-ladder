-- Migration 002 — full climber customization
--
-- Replaces the three fixed cosmetic columns with a single jsonb blob, so
-- adding new parts (hair, boots, gloves, accessories...) never needs another
-- migration. Run once in Supabase → SQL Editor.

alter table public.profiles
  add column if not exists cosmetics jsonb not null default '{}'::jsonb;

-- Carry over anything saved under the old scheme, then drop the old columns.
update public.profiles
set cosmetics = jsonb_strip_nulls(jsonb_build_object(
      'headgearColor', nullif(helmet_color, 'default'),
      'packColor',     nullif(pack_color, 'default')
    ))
where cosmetics = '{}'::jsonb
  and (helmet_color is distinct from 'default' or pack_color is distinct from 'default');

alter table public.profiles drop column if exists helmet_color;
alter table public.profiles drop column if exists pack_color;
alter table public.profiles drop column if exists accessory;

-- Keep the blob from becoming an arbitrary data dump.
alter table public.profiles
  drop constraint if exists cosmetics_is_object;
alter table public.profiles
  add constraint cosmetics_is_object
  check (jsonb_typeof(cosmetics) = 'object' and pg_column_size(cosmetics) < 2048);
