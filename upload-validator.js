/**
 * upload-validator.js
 * 
 * 사진 업로드 2중 검증 일반 스크립트
 * 1. 사용자 현재 위치(GPS) 검증
 * 2. 업로드 대상 사진 EXIF GPS 검증
 * 
 * 업로드 차단 사유 3가지 명확한 분기 (각각 고유한 문구 제공, 가독성을 위한 최소 11px 이상 스타일링 보장):
 * ① 내 위치가 멀다 (사용자 위치가 명소 반경 밖)
 * ② 사진에 위치가 없다 (사진 파일에 EXIF GPS 태그 누락 + 아이폰 옵션 안내)
 * ③ 사진이 다른 곳에서 찍혔다 (사진 속 GPS 위치가 명소 반경 밖)
 *
 * 공개 API: globalThis.UploadValidator
 * 의존 API: globalThis.GeoCalculator, globalThis.ExifGpsReader
 */

(function (global) {
  'use strict';

  /**
   * 브라우저 Geolocation API로 현재 사용자 좌표 가져오기
   * @param {Object} [options]
   * @returns {Promise<{latitude: number, longitude: number}>}
   */
  function getCurrentUserPosition(options) {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('이 브라우저는 위치 정보(GPS)를 지원하지 않습니다.'));
        return;
      }

      var defaultOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      };

      var opts = Object.assign({}, defaultOptions, options || {});

      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        },
        function (err) {
          var message = '현재 위치를 확인할 수 없습니다.';
          if (err.code === 1) message = '위치 정보 접근 권한이 거부되었습니다. 브라우저 설정에서 위치를 허용해 주세요.';
          else if (err.code === 2) message = '위치 신호(GPS)를 잡을 수 없습니다. 잠시 후 다시 시도해 주세요.';
          else if (err.code === 3) message = '위치 확인 시간이 초과되었습니다. 다시 시도해 주세요.';
          reject(new Error(message));
        },
        opts
      );
    });
  }

  /**
   * 거리(m)를 사람이 읽기 좋은 텍스트(예: 320m, 1.4km)로 변환
   */
  function formatDistance(meters) {
    if (meters < 1000) {
      return Math.round(meters) + 'm';
    }
    return (meters / 1000).toFixed(1) + 'km';
  }

  /**
   * 세 가지 차단 사유별 표준 문구 생성 헬퍼
   */
  var ERROR_MESSAGES = {
    // 사유 1: 내 위치가 멀다
    USER_FAR: function (spotName, distanceMeters, radius) {
      return {
        code: 'USER_FAR_FROM_SPOT',
        type: 'user_location',
        title: '내 위치가 명소에서 멀리 떨어져 있습니다',
        message: '현재 계신 위치가 ' + spotName + '에서 ' + formatDistance(distanceMeters) +
          ' 떨어져 있어요. 명소 반경 ' + radius + 'm 이내 현장에 도착하셔야 업로드할 수 있습니다.'
      };
    },

    // 사유 2: 사진에 위치가 없다 (아이폰 선택 화면 옵션 안내 포함)
    PHOTO_NO_GPS: function () {
      return {
        code: 'PHOTO_GPS_MISSING',
        type: 'photo_no_gps',
        title: '사진에 촬영 위치 정보가 없습니다',
        message: '선택하신 사진에 GPS 위치 정보가 기록되어 있지 않아요. 카메라 설정에서 [위치 태그]를 켠 상태로 직접 촬영한 원본 사진을 올려주세요. 아이폰은 사진 선택 화면 위쪽 옵션에서 [위치 포함]을 켜 주세요. (카카오톡 전송이나 화면 캡처 사진은 위치 정보가 지워집니다.)'
      };
    },

    // 사유 3: 사진이 다른 곳에서 찍혔다
    PHOTO_FAR: function (spotName, distanceMeters, radius) {
      return {
        code: 'PHOTO_FAR_FROM_SPOT',
        type: 'photo_other_place',
        title: '사진이 다른 장소에서 촬영되었습니다',
        message: '사진 속 촬영 위치가 ' + spotName + '에서 ' + formatDistance(distanceMeters) +
          ' 떨어진 곳입니다. ' + spotName + ' 현장(반경 ' + radius + 'm 이내)에서 찍힌 사진만 등록할 수 있습니다.'
      };
    }
  };

  /**
   * 업로드 가능 여부 종합 검증 함수 (2중 검증)
   * 
   * @param {File} file - 업로드할 사진 파일
   * @param {Object} spot - 대상 명소 객체 { name, latitude, longitude, radiusMeters }
   * @param {Object} [userCoords] - 사전에 조회된 사용자 좌표 { latitude, longitude } (미전달 시 브라우저에서 직접 조회)
   * @returns {Promise<{isValid: boolean, reasons: string[], errorItems: Array<{code: string, type: string, title: string, message: string}>, details: Object}>}
   */
  async function validateUpload(file, spot, userCoords) {
    var errorItems = [];
    var reasons = [];
    var details = {
      spot: spot,
      userLocation: null,
      photoLocation: null,
      userDistanceMeters: null,
      photoDistanceMeters: null
    };

    var radius = spot.radiusMeters || 500;
    var spotName = spot.name || '해당 명소';

    // 1. 사용자 현재 위치 확인 및 거리 검증
    try {
      var uCoords = userCoords || (await getCurrentUserPosition());
      details.userLocation = uCoords;

      var userDist = global.GeoCalculator.getDistanceInMeters(
        uCoords.latitude,
        uCoords.longitude,
        spot.latitude,
        spot.longitude
      );
      details.userDistanceMeters = userDist;

      // 차단 사유 ① : 내 위치가 멀다
      if (userDist > radius) {
        var userFarErr = ERROR_MESSAGES.USER_FAR(spotName, userDist, radius);
        errorItems.push(userFarErr);
        reasons.push('[' + userFarErr.title + '] ' + userFarErr.message);
      }
    } catch (err) {
      var userLocErr = {
        code: 'USER_LOCATION_ERROR',
        type: 'user_location_error',
        title: '내 위치를 확인할 수 없습니다',
        message: err.message
      };
      errorItems.push(userLocErr);
      reasons.push('[' + userLocErr.title + '] ' + userLocErr.message);
    }

    // 2. 사진 EXIF GPS 확인 및 거리 검증
    try {
      var photoGps = await global.ExifGpsReader.extractGpsCoordinates(file);
      
      // 차단 사유 ② : 사진에 위치가 없다
      if (!photoGps) {
        var noGpsErr = ERROR_MESSAGES.PHOTO_NO_GPS();
        errorItems.push(noGpsErr);
        reasons.push('[' + noGpsErr.title + '] ' + noGpsErr.message);
      } else {
        details.photoLocation = photoGps;
        var photoDist = global.GeoCalculator.getDistanceInMeters(
          photoGps.latitude,
          photoGps.longitude,
          spot.latitude,
          spot.longitude
        );
        details.photoDistanceMeters = photoDist;

        // 차단 사유 ③ : 사진이 다른 곳에서 찍혔다
        if (photoDist > radius) {
          var photoFarErr = ERROR_MESSAGES.PHOTO_FAR(spotName, photoDist, radius);
          errorItems.push(photoFarErr);
          reasons.push('[' + photoFarErr.title + '] ' + photoFarErr.message);
        }
      }
    } catch (err) {
      var parseErr = {
        code: 'PHOTO_PARSE_ERROR',
        type: 'photo_parse_error',
        title: '사진 파일 분석 오류',
        message: '사진 메타데이터를 분석하는 중 오류가 발생했습니다: ' + err.message
      };
      errorItems.push(parseErr);
      reasons.push('[' + parseErr.title + '] ' + parseErr.message);
    }

    return {
      isValid: errorItems.length === 0,
      errorItems: errorItems,
      reasons: reasons,
      details: details
    };
  }

  global.UploadValidator = Object.freeze({
    getCurrentUserPosition: getCurrentUserPosition,
    formatDistance: formatDistance,
    validateUpload: validateUpload,
    ERROR_MESSAGES: ERROR_MESSAGES
  });
})(globalThis);
