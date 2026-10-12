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

  const PHOTO_CURRENT_RADIUS_METERS = 200;
  const MAX_GPS_ACCURACY_ALLOWANCE_METERS = 100;

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

  function createCurrentLocationError(error) {
    return {
      code: 'USER_LOCATION_ERROR',
      type: 'user_location_error',
      title: '현재 위치를 받을 수 없습니다',
      message: error && error.message
        ? error.message
        : '현재 위치를 확인할 수 없습니다. 위치 권한을 확인한 뒤 다시 시도해 주세요.'
    };
  }

  function createPhotoTooFarError(distanceMeters) {
    const distanceText = global.UploadValidator.formatDistance(distanceMeters);
    return {
      code: 'PHOTO_TOO_FAR_FROM_CURRENT_LOCATION',
      type: 'photo_other_place',
      title: '지금 있는 곳과 사진 찍은 곳이 멀리 떨어져 있습니다',
      message: '지금 있는 곳과 사진 찍은 곳이 ' + distanceText +
        ' 떨어져 있어요. GPS 오차 여유(최대 100m)를 반영해 200m 이내에서 찍은 사진만 등록할 수 있습니다.'
    };
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
    const errorItems = [];
    let currentPosition;

    try {
      // 기존 업로드 검사와 같이 매번 새 위치를 요청하며 캐시를 사용하지 않습니다.
      currentPosition = await global.UploadValidator.getCurrentUserPosition({ maximumAge: 0 });
    } catch (error) {
      errorItems.push(createCurrentLocationError(error));
      return { ok: false, city: null, takenAt: null, errorItems: errorItems };
    }

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
    const accuracy = Number.isFinite(currentPosition.accuracy) && currentPosition.accuracy > 0
      ? Math.min(currentPosition.accuracy, MAX_GPS_ACCURACY_ALLOWANCE_METERS)
      : 0;
    const distanceMeters = global.GeoCalculator.getDistanceInMeters(
      currentPosition.latitude,
      currentPosition.longitude,
      metadata.latitude,
      metadata.longitude
    );

    if (distanceMeters > PHOTO_CURRENT_RADIUS_METERS + accuracy) {
      errorItems.push(createPhotoTooFarError(distanceMeters));
    }
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
