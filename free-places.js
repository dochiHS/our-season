/**
 * free-places.js
 * 우리 동네 기록 업로드 검증 유틸리티 (전국 17개 시·도)
 * 공개 API: globalThis.FreePlaces
 * 의존 API: globalThis.GeoCalculator, globalThis.ExifGpsReader, globalThis.UploadValidator
 */
(function (global) {
  'use strict';

  // 시·도 코드와 이름. DB(season_photos.city) 허용 값과 같아야 한다.
  const REGIONS = Object.freeze({
    seoul: Object.freeze({ name: '서울' }),
    busan: Object.freeze({ name: '부산' }),
    daegu: Object.freeze({ name: '대구' }),
    incheon: Object.freeze({ name: '인천' }),
    gwangju: Object.freeze({ name: '광주' }),
    daejeon: Object.freeze({ name: '대전' }),
    ulsan: Object.freeze({ name: '울산' }),
    sejong: Object.freeze({ name: '세종' }),
    gyeonggi: Object.freeze({ name: '경기' }),
    gangwon: Object.freeze({ name: '강원' }),
    chungbuk: Object.freeze({ name: '충북' }),
    chungnam: Object.freeze({ name: '충남' }),
    jeonbuk: Object.freeze({ name: '전북' }),
    jeonnam: Object.freeze({ name: '전남' }),
    gyeongbuk: Object.freeze({ name: '경북' }),
    gyeongnam: Object.freeze({ name: '경남' }),
    jeju: Object.freeze({ name: '제주' })
  });

  // 시·도를 미리 고르기 위한 기준 지점(대략적인 시·군 중심 좌표).
  // 가장 가까운 기준 지점의 시·도를 추천하고, 사용자가 화면에서 바꿀 수 있다.
  const REFERENCE_POINTS = [
    ['seoul', 37.5665, 126.9780], ['seoul', 37.4979, 127.0276], ['seoul', 37.6542, 127.0568], ['seoul', 37.5509, 126.8495], ['seoul', 37.5145, 127.1059],
    ['seoul', 37.4784, 126.9516], ['seoul', 37.6027, 126.9291], ['seoul', 37.5301, 127.1238], ['seoul', 37.5663, 126.9019], ['seoul', 37.6688, 127.0471],
    ['seoul', 37.4954, 126.8874], ['seoul', 37.5170, 126.8664], ['seoul', 37.4837, 127.0324], ['seoul', 37.5894, 127.0167], ['seoul', 37.6063, 127.0925],
    ['seoul', 37.4569, 126.8955], ['seoul', 37.4700, 127.0700], ['seoul', 37.5600, 126.8000],
    ['busan', 35.1796, 129.0756], ['busan', 35.1631, 129.1635], ['busan', 35.0975, 128.9667], ['busan', 35.2440, 129.0920],
    ['daegu', 35.8714, 128.6014], ['daegu', 35.8460, 128.5000], ['daegu', 35.9400, 128.6500],
    ['incheon', 37.4563, 126.7052], ['incheon', 37.7470, 126.4880], ['incheon', 37.4920, 126.4910], ['incheon', 37.9600, 124.6800], ['incheon', 37.6700, 125.7000],
    ['incheon', 37.5070, 126.7219], ['incheon', 37.5390, 126.6440], ['incheon', 37.5372, 126.7377], ['incheon', 37.4473, 126.7314],
    ['incheon', 37.4102, 126.6788], ['incheon', 37.5960, 126.6640],
    ['gwangju', 35.1595, 126.8526], ['gwangju', 35.1900, 126.7900],
    ['daejeon', 36.3504, 127.3845], ['daejeon', 36.3620, 127.3560], ['daejeon', 36.4470, 127.4300],
    ['ulsan', 35.5384, 129.3114], ['ulsan', 35.5600, 129.1300],
    ['sejong', 36.4801, 127.2890], ['sejong', 36.6013, 127.2970], ['sejong', 36.5040, 127.2650],
    ['gyeonggi', 37.2636, 127.0286], ['gyeonggi', 37.6584, 126.8320], ['gyeonggi', 37.4200, 127.1265], ['gyeonggi', 36.9921, 127.1129],
    ['gyeonggi', 37.6153, 126.7156], ['gyeonggi', 37.8949, 127.2003], ['gyeonggi', 37.2720, 127.4350], ['gyeonggi', 37.7600, 126.7800],
    ['gyeonggi', 37.6359, 127.2165], ['gyeonggi', 37.4910, 127.4870], ['gyeonggi', 37.0080, 127.2797], ['gyeonggi', 37.8315, 127.5097],
    ['gyeonggi', 38.0960, 127.0740], ['gyeonggi', 37.3220, 126.8310],
    ['gyeonggi', 37.7381, 127.0337], ['gyeonggi', 37.5034, 126.7660], ['gyeonggi', 37.4786, 126.8646], ['gyeonggi', 37.5393, 127.2148],
    ['gyeonggi', 37.3943, 126.9568], ['gyeonggi', 37.4292, 126.9876], ['gyeonggi', 37.5943, 127.1296], ['gyeonggi', 37.2411, 127.1776],
    ['gyeonggi', 37.1996, 126.8312], ['gyeonggi', 37.3800, 126.8031], ['gyeonggi', 37.3700, 126.7350],
    ['gangwon', 37.8813, 127.7298], ['gangwon', 37.3422, 127.9202], ['gangwon', 37.7519, 128.8761], ['gangwon', 38.2070, 128.5918],
    ['gangwon', 37.6830, 128.7560], ['gangwon', 37.3700, 128.3900], ['gangwon', 38.0697, 128.1707], ['gangwon', 37.1836, 128.4617],
    ['gangwon', 37.1640, 128.9860], ['gangwon', 37.4500, 129.1650], ['gangwon', 38.1460, 127.3130],
    ['chungbuk', 36.6424, 127.4890], ['chungbuk', 36.9910, 127.9260], ['chungbuk', 37.1326, 128.1910], ['chungbuk', 36.3070, 127.5710],
    ['chungbuk', 36.4870, 127.7300], ['chungbuk', 36.1640, 127.7760], ['chungbuk', 36.7853, 127.5815], ['chungbuk', 36.9400, 127.6900],
    ['chungbuk', 36.8560, 127.4350], ['chungbuk', 36.9850, 128.3650], ['chungbuk', 36.6203, 127.3271],
    ['chungnam', 36.6588, 126.6728], ['chungnam', 36.8151, 127.1139], ['chungnam', 36.7898, 127.0019], ['chungnam', 36.4465, 127.1190],
    ['chungnam', 36.3330, 126.6130], ['chungnam', 36.7848, 126.4503], ['chungnam', 36.7450, 126.2980], ['chungnam', 36.2750, 126.9100],
    ['chungnam', 36.1870, 127.0990], ['chungnam', 36.0800, 126.6900], ['chungnam', 36.4600, 126.8000], ['chungnam', 36.1080, 127.4880],
    ['chungnam', 36.2740, 127.2480],
    ['jeonbuk', 35.8242, 127.1480], ['jeonbuk', 35.9676, 126.7369], ['jeonbuk', 35.4164, 127.3904], ['jeonbuk', 35.5699, 126.8560],
    ['jeonbuk', 35.9483, 126.9577], ['jeonbuk', 35.4359, 126.7015], ['jeonbuk', 36.0070, 127.6610], ['jeonbuk', 35.7910, 127.4250],
    ['jeonbuk', 35.7317, 126.7330],
    ['jeonnam', 34.8161, 126.4629], ['jeonnam', 34.7604, 127.6622], ['jeonnam', 34.9506, 127.4872], ['jeonnam', 35.0160, 126.7108],
    ['jeonnam', 34.6810, 125.4300], ['jeonnam', 34.3110, 126.7550], ['jeonnam', 34.5730, 126.5990], ['jeonnam', 35.2020, 127.4630],
    ['jeonnam', 34.7700, 127.0800], ['jeonnam', 35.2800, 126.5100], ['jeonnam', 34.6400, 127.2900], ['jeonnam', 34.0500, 125.1200],
    ['gyeongbuk', 36.5684, 128.7294], ['gyeongbuk', 36.0190, 129.3435], ['gyeongbuk', 35.8562, 129.2247], ['gyeongbuk', 36.1195, 128.3446],
    ['gyeongbuk', 36.4109, 128.1590], ['gyeongbuk', 36.8057, 128.6240], ['gyeongbuk', 36.9930, 129.4000], ['gyeongbuk', 37.4840, 130.9050],
    ['gyeongbuk', 37.2412, 131.8644], ['gyeongbuk', 36.4150, 129.3650], ['gyeongbuk', 36.6580, 128.4500], ['gyeongbuk', 35.9730, 128.9390],
    ['gyeongbuk', 35.9190, 128.2830], ['gyeongbuk', 36.3530, 128.6970], ['gyeongbuk', 36.8930, 128.7320],
    ['gyeongnam', 35.2280, 128.6811], ['gyeongnam', 35.1800, 128.1076], ['gyeongnam', 34.8544, 128.4332], ['gyeongnam', 35.6867, 127.9095],
    ['gyeongnam', 34.8800, 128.6210], ['gyeongnam', 35.5040, 128.7470], ['gyeongnam', 35.3350, 129.0370], ['gyeongnam', 35.0700, 127.7520],
    ['gyeongnam', 34.8370, 127.8920], ['gyeongnam', 35.5650, 128.1650], ['gyeongnam', 35.3220, 128.2880],
    ['jeju', 33.4996, 126.5312], ['jeju', 33.2541, 126.5600], ['jeju', 33.3900, 126.2400], ['jeju', 33.4500, 126.9200], ['jeju', 33.1170, 126.2670]
  ];

  // 가장 가까운 기준 지점이 이 거리 안에 있어야 국내 사진으로 본다.
  const MAX_REFERENCE_DISTANCE_METERS = 45000;

  function guessRegion(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < 32.8 || latitude > 38.7 || longitude < 124.4 || longitude > 132.0) return null;
    let nearestCode = null;
    let nearestDistance = Infinity;
    REFERENCE_POINTS.forEach(function (point) {
      const distance = global.GeoCalculator.getDistanceInMeters(latitude, longitude, point[1], point[2]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCode = point[0];
      }
    });
    return nearestDistance <= MAX_REFERENCE_DISTANCE_METERS ? nearestCode : null;
  }

  function isRegionCode(code) {
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(REGIONS, code);
  }

  function regionName(code) {
    return isRegionCode(code) ? REGIONS[code].name : (code || '');
  }

  function createOutsideKoreaError() {
    return {
      code: 'PHOTO_OUTSIDE_KOREA',
      type: 'photo_outside_korea',
      title: '국내에서 찍은 사진이 아니에요',
      message: '우리 동네 기록에는 국내에서 찍은 사진만 올릴 수 있어요.'
    };
  }

  async function validateFreeUpload(file) {
    // 우리 동네 기록은 현재 위치를 묻지 않습니다. 사진 EXIF의 촬영 위치로 시·도를 추천하며,
    // 좌표는 결과에 담지도 저장하지도 않습니다.
    const errorItems = [];

    let metadata;
    try {
      metadata = await global.ExifGpsReader.extractMetadataFromImage(file);
    } catch (error) {
      metadata = null;
    }

    if (!metadata || !metadata.success ||
        !Number.isFinite(metadata.latitude) || !Number.isFinite(metadata.longitude)) {
      errorItems.push(global.UploadValidator.ERROR_MESSAGES.PHOTO_NO_GPS());
      return {
        ok: false,
        city: null,
        takenAt: metadata && metadata.takenAt ? metadata.takenAt : null,
        errorItems: errorItems
      };
    }

    const takenAt = metadata.takenAt || null;
    const city = guessRegion(metadata.latitude, metadata.longitude);
    if (!city) {
      errorItems.push(createOutsideKoreaError());
    }

    return {
      ok: errorItems.length === 0,
      city: city,
      takenAt: takenAt,
      errorItems: errorItems
    };
  }

  global.FreePlaces = Object.freeze({
    REGIONS: REGIONS,
    CITIES: REGIONS,
    guessRegion: guessRegion,
    detectCity: guessRegion,
    isRegionCode: isRegionCode,
    regionName: regionName,
    validateFreeUpload: validateFreeUpload
  });
})(globalThis);
