-- supabase-migration-13.sql
-- 사진은 로그인한 사람만 올리고, 내가 올린 사진은 내가 지울 수 있게 한다.
-- 일기(diary) 테이블은 건드리지 않는다. season_photos 와 season-photos 버킷만 바꾼다.
-- 로그인 전에 올라간 예전 사진은 주인이 없어서(user_id 비어 있음) 운영자만 지울 수 있다.

begin;

-- 1) 누가 올렸는지 기록
alter table public.season_photos
  add column if not exists user_id uuid default auth.uid()
    references auth.users(id) on delete set null;

create index if not exists season_photos_user_id_idx
  on public.season_photos (user_id);

-- 2) 비로그인 업로드 막기
drop policy if exists season_photos_anon_insert_pending on public.season_photos;
revoke insert on table public.season_photos from anon;

-- 3) 로그인 사용자 권한
grant select, insert, delete on table public.season_photos to authenticated;

-- 공개 사진 + 내가 올린 사진(승인 대기 포함) 보기
drop policy if exists season_photos_user_select on public.season_photos;
create policy season_photos_user_select
  on public.season_photos
  for select
  to authenticated
  using (status = 'approved' or user_id = (select auth.uid()));

-- 내 이름으로, 승인 대기 상태로만 올리기
drop policy if exists season_photos_user_insert_pending on public.season_photos;
create policy season_photos_user_insert_pending
  on public.season_photos
  for insert
  to authenticated
  with check (status = 'pending' and user_id = (select auth.uid()));

-- 내가 올린 사진만 지우기
drop policy if exists season_photos_user_delete_own on public.season_photos;
create policy season_photos_user_delete_own
  on public.season_photos
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- 4) 사진 파일(Storage)
-- 비로그인 업로드 막고, 로그인 사용자만 올리기
drop policy if exists season_photos_storage_anon_insert on storage.objects;

drop policy if exists season_photos_storage_insert_anon_only_guard on storage.objects;
drop policy if exists season_photos_storage_insert_login_guard on storage.objects;
create policy season_photos_storage_insert_login_guard
  on storage.objects
  as restrictive
  for insert
  to public
  with check (bucket_id <> 'season-photos' or (select auth.uid()) is not null);

drop policy if exists season_photos_storage_user_insert on storage.objects;
create policy season_photos_storage_user_insert
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'season-photos');

-- 지우기: 운영자 또는 파일을 올린 본인만
drop policy if exists season_photos_storage_block_delete on storage.objects;
create policy season_photos_storage_block_delete
  on storage.objects
  as restrictive
  for delete
  to public
  using (
    bucket_id <> 'season-photos'
    or public.is_season_admin()
    or owner_id = (select auth.uid())::text
  );

drop policy if exists season_photos_storage_user_delete_own on storage.objects;
create policy season_photos_storage_user_delete_own
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'season-photos' and owner_id = (select auth.uid())::text);

-- Storage 파일 삭제는 select 권한도 있어야 해서, 내 파일 select 도 허용
drop policy if exists season_photos_storage_user_select_own on storage.objects;
create policy season_photos_storage_user_select_own
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'season-photos' and owner_id = (select auth.uid())::text);

commit;
