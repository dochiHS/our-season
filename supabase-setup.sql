-- 이 SQL은 Supabase SQL Editor에서 한 번 실행한다

-- 공유 사진 메타데이터. spot_id와 point_id는 앱의 명소/촬영 지점 ID를 저장한다.
create table public.season_photos (
  id uuid primary key default gen_random_uuid(),
  spot_id text not null,
  point_id text not null,
  season text not null check (season in ('spring', 'summer', 'autumn', 'winter')),
  time_of_day text not null check (time_of_day in ('sunrise', 'day', 'sunset', 'night')),
  weather text not null check (weather in ('clear', 'cloudy', 'rain', 'snow', 'fog', 'other')),
  weather_note text check (weather_note is null or char_length(weather_note) <= 10),
  memo text check (memo is null or char_length(memo) <= 30),
  nickname text not null check (char_length(nickname) between 1 and 20),
  photo_path text not null,
  taken_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now()
);

alter table public.season_photos enable row level security;

grant select, insert on table public.season_photos to anon;

create policy season_photos_anon_select_approved
  on public.season_photos
  for select
  to anon
  using (status = 'approved');

create policy season_photos_anon_insert_pending
  on public.season_photos
  for insert
  to anon
  with check (status = 'pending');

-- season_photos에는 UPDATE 또는 DELETE 정책을 만들지 않는다.

-- 공개 읽기 버킷. 승인 전 사진도 파일의 공개 URL을 아는 사람은 직접 열 수 있으므로,
-- 앱에서는 승인된 레코드만 노출하고 공개 전 파일 경로를 예측하기 어렵게 관리해야 한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('season-photos', 'season-photos', true, 2097152, array['image/jpeg']);

-- 익명 역할은 이 버킷에 새 파일만 추가할 수 있다.
create policy season_photos_storage_anon_insert
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'season-photos');

-- 제한 정책은 다른 버킷에 영향을 주지 않으면서 이 버킷에서 기존의 넓은 허용 정책이
-- 덮어쓰기·삭제를 허용하지 못하게 한다. service_role 등 RLS 우회 역할은 별도다.
create policy season_photos_storage_insert_anon_only_guard
  on storage.objects
  as restrictive
  for insert
  to public
  with check (bucket_id <> 'season-photos' or current_user = 'anon');

create policy season_photos_storage_block_update
  on storage.objects
  as restrictive
  for update
  to public
  using (bucket_id <> 'season-photos')
  with check (bucket_id <> 'season-photos');

create policy season_photos_storage_block_delete
  on storage.objects
  as restrictive
  for delete
  to public
  using (bucket_id <> 'season-photos');
