(function (global) {
  'use strict';
  // 한국관광콘텐츠랩 고품질사진 · 공공누리 제1유형(출처 표시) · 최근 5년 안 사진만 사용
  // 출처 표기: ⓒ한국관광콘텐츠랩-촬영자
  const BASE = 'https://tong.visitkorea.or.kr/cms/resource_photo/';
  const PHOTOS = [
    { spotId: 'sangdang-sanseong', season: 'spring', id: '0AeHQj', month: '2025.05', by: '이범수', thumb: BASE + '54/3504254_image3_1.JPG', image: BASE + '54/3504254_image2_1.JPG' },
    { spotId: 'sangdang-sanseong', season: 'spring', id: 'QEeSLq', month: '2025.05', by: '이범수', thumb: BASE + '56/3504256_image3_1.JPG', image: BASE + '56/3504256_image2_1.JPG' },
    { spotId: 'sangdang-sanseong', season: 'summer', id: '45BYu5', month: '2024.08', by: '김영호', thumb: BASE + '69/3389369_image3_1.jpg', image: BASE + '69/3389369_image2_1.jpg' },
    { spotId: 'sangdang-sanseong', season: 'summer', id: '4KXzpj', month: '2024.08', by: '김영호', thumb: BASE + '63/3389363_image3_1.jpg', image: BASE + '63/3389363_image2_1.jpg' },
    { spotId: 'jungbuk-dong', season: 'spring', id: '8dxSNw', month: '2025.05', by: '이범수', thumb: BASE + '84/3505084_image3_1.JPG', image: BASE + '84/3505084_image2_1.JPG' },
    { spotId: 'jungbuk-dong', season: 'spring', id: 'YE2Fcx', month: '2025.05', by: '이범수', thumb: BASE + '38/3505138_image3_1.jpg', image: BASE + '38/3505138_image2_1.jpg' },
    { spotId: 'jungbuk-dong', season: 'summer', id: 'OXgD4p', month: '2023.08', by: '한승호', thumb: BASE + '85/3024785_image3_1.jpg', image: BASE + '85/3024785_image2_1.jpg' },
    { spotId: 'jungbuk-dong', season: 'summer', id: 'wuULKV', month: '2023.08', by: '한승호', thumb: BASE + '86/3024786_image3_1.jpg', image: BASE + '86/3024786_image2_1.jpg' },
    { spotId: 'cheongnamdae', season: 'summer', id: '4jUwEy', month: '2026.06', by: '손정원', thumb: BASE + '80/4118280_image3_1.JPG', image: BASE + '80/4118280_image2_1.JPG' },
    { spotId: 'cheongnamdae', season: 'summer', id: 'QIObu4', month: '2024.06', by: '강윤구', thumb: BASE + '85/3339385_image3_1.jpg', image: BASE + '85/3339385_image2_1.jpg' },
    { spotId: 'munui-daecheongho', season: 'summer', id: 'cFx7qn', month: '2026.06', by: '손정원', thumb: BASE + '25/4118125_image3_1.jpg', image: BASE + '25/4118125_image2_1.jpg' },
    { spotId: 'munui-daecheongho', season: 'summer', id: '3yNa2w', month: '2026.06', by: '손정원', thumb: BASE + '72/4118172_image3_1.jpg', image: BASE + '72/4118172_image2_1.jpg' }
  ];
  function getReferencePhotos(spotId, season) {
    return PHOTOS.filter(p => p.spotId === spotId && p.season === season);
  }
  function creditOf(photo) {
    return 'ⓒ한국관광콘텐츠랩-' + photo.by;
  }
  global.ReferencePhotos = Object.freeze({ getReferencePhotos, creditOf });
})(window);
