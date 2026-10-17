-- supabase-migration-14.sql
-- 사진을 찍을 때 폰이 바라본 방향(0~359도, 북=0, 동=90)을 저장한다.
-- 사진 정보(EXIF)에서 읽거나, 올리는 사람이 8방향 중에 고른다. 모르면 비워 둔다.
-- 일기(diary) 테이블은 건드리지 않는다.

begin;

alter table public.season_photos
  add column if not exists heading smallint;

alter table public.season_photos
  drop constraint if exists season_photos_heading_check;

alter table public.season_photos
  add constraint season_photos_heading_check
  check (heading is null or heading between 0 and 359);

commit;
