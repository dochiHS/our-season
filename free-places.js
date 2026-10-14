/**
 * free-places.js
 * 우리 동네 기록 업로드 검증 유틸리티 (전국 시·군 단위)
 * 공개 API: globalThis.FreePlaces
 * 의존 API: globalThis.FreePlacesData, globalThis.ExifGpsReader, globalThis.UploadValidator
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

  const DATA = global.FreePlacesData;

  // 시·군 목록: { key: '충북|청주', city: 'chungbuk', district: '청주' }
  const UNITS = Object.freeze(DATA.units.map(function (unit) {
    return Object.freeze({ key: unit[0] + '|' + unit[1], city: unit[0], district: unit[1] });
  }));

  // 이름이 겹치는 시·군(경기 광주와 광주광역시, 강원·경남 고성)은 시·도를 붙여 보여 준다.
  const NAME_COUNT = UNITS.reduce(function (counts, unit) {
    counts[unit.district] = (counts[unit.district] || 0) + 1;
    return counts;
  }, {});

  // 섬 하나가 격자 한 칸보다 작아 위치표에 잡히지 않는 곳
  const SMALL_ISLANDS = [
    { lat: 37.2412, lng: 131.8644, radiusMeters: 3000, city: 'gyeongbuk', district: '울릉' } // 독도
  ];

  // 사진 위치가 바다 위(해변·배·작은 섬)일 때 이 거리 안의 가장 가까운 시·군으로 본다.
  const SEA_SEARCH_METERS = 12000;

  let decodedGrid = null;

  function decodeGrid() {
    if (decodedGrid) return decodedGrid;
    const grid = new Uint8Array(DATA.rows * DATA.cols);
    const rows = DATA.rle.split(',');
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      let c = 0;
      for (let i = 0; i + 4 <= row.length; i += 4) {
        const value = parseInt(row.substr(i, 2), 36);
        const length = parseInt(row.substr(i + 2, 2), 36);
        if (value) grid.fill(value, r * DATA.cols + c, r * DATA.cols + c + length);
        c += length;
      }
    }
    decodedGrid = grid;
    return grid;
  }

  function cellValue(grid, r, c) {
    if (r < 0 || c < 0 || r >= DATA.rows || c >= DATA.cols) return 0;
    return grid[r * DATA.cols + c];
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // 촬영 위치 → { city, district } 또는 국내가 아니면 null
  function guessPlace(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    for (let i = 0; i < SMALL_ISLANDS.length; i += 1) {
      const island = SMALL_ISLANDS[i];
      if (distanceMeters(latitude, longitude, island.lat, island.lng) <= island.radiusMeters) {
        return { city: island.city, district: island.district };
      }
    }

    const r = Math.floor((DATA.lat1 - latitude) / DATA.dLat);
    const c = Math.floor((longitude - DATA.lng0) / DATA.dLng);
    if (r < 0 || c < 0 || r >= DATA.rows || c >= DATA.cols) return null;

    const grid = decodeGrid();
    let value = cellValue(grid, r, c);

    if (!value) {
      // 바다 위: 둘레를 넓혀 가며 가장 가까운 육지 칸을 찾는다.
      const cellLatMeters = DATA.dLat * 111320;
      const maxRing = Math.ceil(SEA_SEARCH_METERS / cellLatMeters) + 1;
      let bestDistance = Infinity;
      for (let ring = 1; ring <= maxRing && bestDistance === Infinity; ring += 1) {
        for (let dr = -ring; dr <= ring; dr += 1) {
          for (let dc = -ring; dc <= ring; dc += 1) {
            if (Math.abs(dr) !== ring && Math.abs(dc) !== ring) continue;
            const v = cellValue(grid, r + dr, c + dc);
            if (!v) continue;
            const cellLat = DATA.lat1 - (r + dr + 0.5) * DATA.dLat;
            const cellLng = DATA.lng0 + (c + dc + 0.5) * DATA.dLng;
            const distance = distanceMeters(latitude, longitude, cellLat, cellLng);
            if (distance < bestDistance) {
              bestDistance = distance;
              value = v;
            }
          }
        }
      }
      if (bestDistance > SEA_SEARCH_METERS) value = 0;
    }

    if (!value) return null;
    const unit = UNITS[value - 1];
    return unit ? { city: unit.city, district: unit.district } : null;
  }

  function guessRegion(latitude, longitude) {
    const place = guessPlace(latitude, longitude);
    return place ? place.city : null;
  }

  function isRegionCode(code) {
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(REGIONS, code);
  }

  function regionName(code) {
    return isRegionCode(code) ? REGIONS[code].name : (code || '');
  }

  function findUnit(city, district) {
    for (let i = 0; i < UNITS.length; i += 1) {
      if (UNITS[i].city === city && UNITS[i].district === district) return UNITS[i];
    }
    return null;
  }

  function isValidPlace(city, district) {
    return Boolean(findUnit(city, district));
  }

  // 화면에 보일 짧은 이름: 청주, 천안, 서울 … (겹치는 이름은 '경기 광주'처럼)
  function placeLabel(city, district) {
    if (!district) return regionName(city);
    if (NAME_COUNT[district] > 1 && city !== 'gwangju') return regionName(city) + ' ' + district;
    return district;
  }

  // 시·도까지 붙인 이름: 충북 청주, 서울 …
  function placeFullName(city, district) {
    if (!district) return regionName(city);
    if (district === regionName(city)) return district;
    return regionName(city) + ' ' + district;
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
    // 우리 동네 기록은 현재 위치를 묻지 않습니다. 사진 EXIF의 촬영 위치로 시·군을 추천하며,
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
        district: null,
        takenAt: metadata && metadata.takenAt ? metadata.takenAt : null,
        errorItems: errorItems
      };
    }

    const takenAt = metadata.takenAt || null;
    const place = guessPlace(metadata.latitude, metadata.longitude);
    if (!place) {
      errorItems.push(createOutsideKoreaError());
    }

    return {
      ok: errorItems.length === 0,
      city: place ? place.city : null,
      district: place ? place.district : null,
      takenAt: takenAt,
      errorItems: errorItems
    };
  }

  global.FreePlaces = Object.freeze({
    REGIONS: REGIONS,
    CITIES: REGIONS,
    UNITS: UNITS,
    guessPlace: guessPlace,
    guessRegion: guessRegion,
    detectCity: guessRegion,
    isRegionCode: isRegionCode,
    isValidPlace: isValidPlace,
    regionName: regionName,
    placeLabel: placeLabel,
    placeFullName: placeFullName,
    validateFreeUpload: validateFreeUpload
  });
})(window);
