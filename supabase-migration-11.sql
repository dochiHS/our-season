-- 우리 동네 기록에 시·군 이름(district) 칸을 추가한다. 예: 청주, 천안, 평창, 서울
-- 기존 기록은 사진 저장 경로(free/<예전 도시>/...)로 원래 도시 이름을 되살린다.
-- public.season_photos 에 칸 하나와 길이 규칙만 추가하며, 다른 테이블과 보안 정책은 건드리지 않는다.

begin;

alter table public.season_photos
  add column if not exists district text;

alter table public.season_photos
  add constraint season_photos_district_check
  check (district is null or char_length(district) between 1 and 20);

update public.season_photos
set district = case
  when photo_path like 'free/cheongju/%' then '청주'
  when photo_path like 'free/cheonan/%' then '천안'
  when photo_path like 'free/gimpo/%' then '김포'
  when photo_path like 'free/daejeon/%' then '대전'
  when photo_path like 'free/sejong/%' then '세종'
end
where kind = 'free'
  and district is null
  and (photo_path like 'free/cheongju/%'
    or photo_path like 'free/cheonan/%'
    or photo_path like 'free/gimpo/%'
    or photo_path like 'free/daejeon/%'
    or photo_path like 'free/sejong/%');

commit;
