-- 동네 기록: 올린 사람이 허락한 경우에만 약 100m 단위로 뭉갠 위치를 저장한다.
-- numeric(…,3)이라 서버가 소수 셋째 자리로 자동 반올림한다(정확한 좌표는 저장되지 않음).
-- public.season_photos 에 칸 2개와 규칙 1개만 추가하며, 다른 테이블과 보안 정책은 건드리지 않는다.

begin;

alter table public.season_photos
  add column if not exists approx_lat numeric(6,3),
  add column if not exists approx_lng numeric(7,3);

alter table public.season_photos
  add constraint season_photos_approx_location_check
  check (
    (approx_lat is null and approx_lng is null)
    or (kind = 'free'
        and approx_lat between 32.8 and 38.7
        and approx_lng between 124.4 and 132.0)
  );

commit;
