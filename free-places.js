/**
 * free-places.js
 * 우리 동네 기록 업로드 위치 검증 유틸리티
 * 공개 API: globalThis.FreePlaces
 * 의존 API: globalThis.GeoCalculator, globalThis.ExifGpsReader, globalThis.UploadValidator
 */
(function (global) {
  'use strict';

  const CITIES = Object.freeze({
    cheongju: Object.freeze({ name: '청주', latitude: 36.6424, longitude: 127.4890, radiusMeters: 17000 }),
    cheonan: Object.freeze({ name: '천안', latitude: 36.8151, longitude: 127.1139, radiusMeters: 18000 }),
    sejong: Object.freeze({ name: '세종', latitude: 36.4801, longitude: 127.2890, radiusMeters: 15000 }),
    gimpo: Object.freeze({ name: '김포', latitude: 37.6153, longitude: 126.7156, radiusMeters: 20000 }),
    daejeon: Object.freeze({ name: '대전', latitude: 36.3504, longitude: 127.3845, radiusMeters: 15000 })
  });


  function detectCity(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    let nearestCode = null;
    let nearestCity = null;
    let nearestDistance = Infinity;
    Object.keys(CITIES).forEach(function (code) {
      const city = CITIES[code];
      const distance = global.GeoCalculator.getDistanceInMeters(
        latitude,
        longitude,
        city.latitude,
        city.longitude
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCode = code;
        nearestCity = city;
      }
    });

    return nearestCity && nearestDistance <= nearestCity.radiusMeters ? nearestCode : null;
  }

  function createOutsideCityError() {
    return {
      code: 'PHOTO_OUTSIDE_SUPPORTED_CITIES',
      type: 'photo_outside_city',
      title: '청주·천안·세종·김포·대전 밖에서 찍은 사진',
      message: '청주·천안·세종·김포·대전 안에서 찍은 사진만 등록할 수 있습니다.'
    };
  }

  async function validateFreeUpload(file) {
    // 우리 동네 기록은 현재 위치를 묻지 않습니다. 사진 EXIF의 촬영 위치로 도시만 판정하며,
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
    const city = detectCity(metadata.latitude, metadata.longitude);
    if (!city) {
      errorItems.push(createOutsideCityError());
    }

    return {
      ok: errorItems.length === 0,
      city: city,
      takenAt: takenAt,
      errorItems: errorItems
    };
  }

  global.FreePlaces = Object.freeze({
    CITIES: CITIES,
    detectCity: detectCity,
    validateFreeUpload: validateFreeUpload
  });
})(globalThis);
