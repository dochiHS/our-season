-- 우리 동네 기록의 지역 단위를 5개 도시에서 전국 17개 시·도로 넓힌다.
-- 이미 올라온 기록의 도시 값은 시·도 값으로 옮겨 적는다(청주→충북, 천안→충남, 김포→경기, 세종·대전은 그대로).
-- public.season_photos 의 city 허용 값 규칙만 바꾸며, 다른 테이블과 보안 정책은 건드리지 않는다.

begin;

alter table public.season_photos
  drop constraint season_photos_city_check;

update public.season_photos
set city = case city
  when 'cheongju' then 'chungbuk'
  when 'cheonan' then 'chungnam'
  when 'gimpo' then 'gyeonggi'
  else city
end
where city in ('cheongju', 'cheonan', 'gimpo');

alter table public.season_photos
  add constraint season_photos_city_check
  check (
    city is null or city in (
      'seoul', 'busan', 'daegu', 'incheon', 'gwangju', 'daejeon', 'ulsan', 'sejong',
      'gyeonggi', 'gangwon', 'chungbuk', 'chungnam', 'jeonbuk', 'jeonnam',
      'gyeongbuk', 'gyeongnam', 'jeju'
    )
  );

commit;
