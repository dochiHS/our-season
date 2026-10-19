-- supabase-migration-15.sql
-- 위치 정보가 없는 명소 사진을 '위치 미확인'으로 받는다.
-- 조건: 위치가 확인된 사진이 한 번 이상 승인된 사람만, 24시간에 3장까지. 우리 동네 기록은 해당 없음.
-- 일기(diary) 테이블은 건드리지 않는다.

begin;

-- 1) 위치 확인 여부 (기존 사진은 모두 확인된 것으로 본다)
alter table public.season_photos
  add column if not exists location_verified boolean not null default true;

-- 2) 위치 미확인 사진을 올릴 수 있는지 판단
create or replace function public.can_upload_unverified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.season_photos
      where user_id = auth.uid() and status = 'approved' and location_verified = true
    )
    and (
      select count(*) from public.season_photos
      where user_id = auth.uid() and location_verified = false
        and created_at > now() - interval '1 day'
    ) < 3;
$$;

revoke all on function public.can_upload_unverified() from public;
grant execute on function public.can_upload_unverified() to authenticated;

-- 3) 올리기 규칙: 위치 미확인은 명소 사진만, 위 조건을 만족할 때만
drop policy if exists season_photos_user_insert_pending on public.season_photos;
create policy season_photos_user_insert_pending
  on public.season_photos
  for insert
  to authenticated
  with check (
    status = 'pending'
    and user_id = (select auth.uid())
    and (
      location_verified
      or (kind is distinct from 'free' and public.can_upload_unverified())
    )
  );

commit;
