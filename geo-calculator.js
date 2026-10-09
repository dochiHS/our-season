// 거리 계산 유틸리티 (Haversine 공식)
// 일반 스크립트 방식이며 공개 API는 globalThis.GeoCalculator에서 사용할 수 있습니다.
(function (global) {
  'use strict';

  /** 두 좌표 사이의 거리를 미터 단위로 계산합니다. */
  function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const earthRadiusMeters = 6371000;
    const toRadians = degrees => (degrees * Math.PI) / 180;
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLon = toRadians(lon2 - lon1);

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
      Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(earthRadiusMeters * c);
  }

  /** 좌표가 지정 반경 이내인지와 계산 거리를 반환합니다. */
  function isWithinRadius(targetLat, targetLon, currentLat, currentLon, maxMeters = 500) {
    const distance = getDistanceInMeters(targetLat, targetLon, currentLat, currentLon);
    return {
      valid: distance <= maxMeters,
      distance,
      maxDistance: maxMeters
    };
  }

  // 기존 호출부(upload-validator.js)의 calculateDistance 이름도 지원합니다.
  global.GeoCalculator = Object.freeze({
    getDistanceInMeters,
    calculateDistance: getDistanceInMeters,
    isWithinRadius
  });
})(globalThis);
