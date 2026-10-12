/**
 * upload-validator.js
 *
 * 사진 업로드 2중 검증 일반 스크립트
 * 1. 사용자 현재 위치(GPS) 검증
 * 2. 업로드 대상 사진 EXIF GPS 검증
 *
 * 사용자와 사진 위치가 모두 같은 촬영 지점의 반경 안에 있을 때만 통과합니다.
 * 공개 API: globalThis.UploadValidator
 * 의존 API: globalThis.GeoCalculator, globalThis.ExifGpsReader
 */
(function (global) {
  'use strict';

  /**
   * 브라우저 Geolocation API로 현재 사용자 좌표 가져오기
   * @param {Object} [options]
   * @returns {Promise<{latitude: number, longitude: number, accuracy: number}>}
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

  /** 거리(m)를 사람이 읽기 좋은 텍스트(예: 320m, 1.4km)로 변환 */
  function formatDistance(meters) {
    if (meters < 1000) return Math.round(meters) + 'm';
    return (meters / 1000).toFixed(1) + 'km';
  }

  var ERROR_MESSAGES = {
    USER_FAR: function (pointName, distanceMeters, radius) {
      return {
        code: 'USER_FAR_FROM_SPOT',
        type: 'user_location',
        title: '내 위치가 명소에서 멀리 떨어져 있습니다',
        message: '현재 계신 위치가 가장 가까운 지점인 ' + pointName + '에서 ' + formatDistance(distanceMeters) +
          ' 떨어져 있어요. 위치 정확도를 반영한 허용 반경 ' + radius + 'm 이내 현장에 도착하셔야 업로드할 수 있습니다.'
      };
    },

    PHOTO_NO_GPS: function () {
      return {
        code: 'PHOTO_GPS_MISSING',
        type: 'photo_no_gps',
        title: '사진에 촬영 위치 정보가 없습니다',
        message: '선택하신 사진에 GPS 위치 정보가 기록되어 있지 않아요. 카메라 설정에서 [위치 태그]를 켠 상태로 직접 촬영한 원본 사진을 올려주세요. 아이폰은 사진 선택 화면 위쪽 옵션에서 [위치 포함]을 켜 주세요. (카카오톡 전송이나 화면 캡처 사진은 위치 정보가 지워집니다.) 아이폰은 사진 선택 창의 사진 찍기 말고 카메라 앱으로 찍어서 올려 주세요.'
      };
    },

    PHOTO_FAR: function (pointName, distanceMeters, radius, differentPoint) {
      return {
        code: 'PHOTO_FAR_FROM_SPOT',
        type: 'photo_other_place',
        title: '사진이 다른 장소에서 촬영되었습니다',
        message: differentPoint
          ? '사진 위치와 현재 위치가 같은 촬영 지점의 반경에 함께 들어오지 않습니다. 사진에서 가장 가까운 지점인 ' + pointName + '까지 ' + formatDistance(distanceMeters) + '입니다. 현재 위치와 사진 위치가 모두 같은 지점의 반경 안에 있어야 등록할 수 있습니다.'
          : '사진 속 촬영 위치가 가장 가까운 지점인 ' + pointName + '에서 ' + formatDistance(distanceMeters) +
            ' 떨어진 곳입니다. ' + pointName + ' 현장(반경 ' + radius + 'm 이내)에서 찍힌 사진만 등록할 수 있습니다.'
      };
    }
  };

  function getSpotPoints(spot) {
    if (spot && Array.isArray(spot.points)) {
      return spot.points.filter(function (point) {
        return point && typeof point.latitude === 'number' && typeof point.longitude === 'number';
      }).map(function (point) {
        return {
          id: point.id,
          name: point.name || '촬영 지점',
          latitude: point.latitude,
          longitude: point.longitude,
          radiusMeters: Number(point.radiusMeters) > 0 ? Number(point.radiusMeters) : 500
        };
      });
    }

    // 기존 단일 좌표 호출부와의 호환
    if (spot && typeof spot.latitude === 'number' && typeof spot.longitude === 'number') {
      return [{
        id: spot.id || null,
        name: spot.pointName || spot.name || '해당 명소',
        latitude: spot.latitude,
        longitude: spot.longitude,
        radiusMeters: Number(spot.radiusMeters) > 0 ? Number(spot.radiusMeters) : 500
      }];
    }
    return [];
  }

  function getClosestPoint(points, latitude, longitude) {
    return points.map(function (point) {
      return {
        point: point,
        distanceMeters: global.GeoCalculator.getDistanceInMeters(
          latitude,
          longitude,
          point.latitude,
          point.longitude
        )
      };
    }).sort(function (a, b) {
      return a.distanceMeters - b.distanceMeters;
    })[0] || null;
  }

  /**
   * 업로드 가능 여부 종합 검증 함수 (현재 위치와 사진 EXIF GPS 2중 검증)
   * 위치 좌표는 호출 시점마다 브라우저에서 새로 조회합니다.
   * @param {File} file 업로드할 사진 파일
   * @param {Object} spot 명소 객체 { name, points: [{id, name, latitude, longitude, radiusMeters}] }
   */
  async function validateUpload(file, spot) {
    var errorItems = [];
    var reasons = [];
    var points = getSpotPoints(spot);
    var details = {
      spot: spot,
      userLocation: null,
      photoLocation: null,
      userDistanceMeters: null,
      photoDistanceMeters: null,
      nearestUserPointId: null,
      nearestPhotoPointId: null,
      pointId: null,
      matchedPoint: null
    };
    var spotName = spot && spot.name || '해당 명소';

    if (!points.length) {
      var noPointsErr = {
        code: 'SPOT_POINTS_MISSING',
        type: 'spot_configuration_error',
        title: '촬영 지점 정보를 확인할 수 없습니다',
        message: spotName + '의 촬영 지점 좌표가 등록되어 있지 않습니다.'
      };
      return { isValid: false, errorItems: [noPointsErr], reasons: ['[' + noPointsErr.title + '] ' + noPointsErr.message], details: details };
    }

    var userCoords;
    try {
      userCoords = await getCurrentUserPosition({ maximumAge: 0 });
      details.userLocation = userCoords;
    } catch (err) {
      var userLocErr = {
        code: 'USER_LOCATION_ERROR',
        type: 'user_location_error',
        title: '내 위치를 확인할 수 없습니다',
        message: err.message
      };
      errorItems.push(userLocErr);
      reasons.push('[' + userLocErr.title + '] ' + userLocErr.message);
      return { isValid: false, errorItems: errorItems, reasons: reasons, details: details };
    }

    var accuracy = Number.isFinite(userCoords.accuracy) && userCoords.accuracy > 0
      ? Math.min(userCoords.accuracy, 100)
      : 0;
    var userDistances = points.map(function (point) {
      var distanceMeters = global.GeoCalculator.getDistanceInMeters(
        userCoords.latitude,
        userCoords.longitude,
        point.latitude,
        point.longitude
      );
      return {
        point: point,
        distanceMeters: distanceMeters,
        allowedRadius: point.radiusMeters + accuracy
      };
    }).sort(function (a, b) {
      return a.distanceMeters - b.distanceMeters;
    });
    var closestUser = userDistances[0];
    var userMatches = userDistances.filter(function (item) {
      return item.distanceMeters <= item.allowedRadius;
    });
    details.userDistanceMeters = closestUser.distanceMeters;
    details.nearestUserPointId = closestUser.point.id || null;

    var photoGps;
    var photoParseError = null;
    try {
      photoGps = await global.ExifGpsReader.extractGpsCoordinates(file);
    } catch (err) {
      photoParseError = err;
    }

    if (photoParseError) {
      var parseErr = {
        code: 'PHOTO_PARSE_ERROR',
        type: 'photo_parse_error',
        title: '사진 파일 분석 오류',
        message: '사진 메타데이터를 분석하는 중 오류가 발생했습니다: ' + photoParseError.message
      };
      errorItems.push(parseErr);
      reasons.push('[' + parseErr.title + '] ' + parseErr.message);
    } else if (!photoGps) {
      var noGpsErr = ERROR_MESSAGES.PHOTO_NO_GPS();
      errorItems.push(noGpsErr);
      reasons.push('[' + noGpsErr.title + '] ' + noGpsErr.message);
    } else {
      details.photoLocation = photoGps;
      var photoDistances = points.map(function (point) {
        var distanceMeters = global.GeoCalculator.getDistanceInMeters(
          photoGps.latitude,
          photoGps.longitude,
          point.latitude,
          point.longitude
        );
        return {
          point: point,
          distanceMeters: distanceMeters,
          allowedRadius: point.radiusMeters
        };
      }).sort(function (a, b) {
        return a.distanceMeters - b.distanceMeters;
      });
      var closestPhoto = photoDistances[0];
      var photoMatches = photoDistances.filter(function (item) {
        return item.distanceMeters <= item.allowedRadius;
      });
      details.photoDistanceMeters = closestPhoto.distanceMeters;
      details.nearestPhotoPointId = closestPhoto.point.id || null;

      var commonMatches = userMatches.map(function (userMatch) {
        var photoMatch = photoMatches.find(function (item) {
          return item.point.id === userMatch.point.id;
        });
        return photoMatch ? {
          point: userMatch.point,
          userDistanceMeters: userMatch.distanceMeters,
          photoDistanceMeters: photoMatch.distanceMeters
        } : null;
      }).filter(Boolean).sort(function (a, b) {
        // 여러 지점에서 통과할 때 현재 위치에서 가장 가까운 지점을 결과로 사용
        return a.userDistanceMeters - b.userDistanceMeters || a.photoDistanceMeters - b.photoDistanceMeters;
      });

      if (commonMatches.length) {
        var matched = commonMatches[0];
        details.pointId = matched.point.id || null;
        details.matchedPoint = matched.point;
      } else {
        if (!userMatches.length) {
          var userErr = ERROR_MESSAGES.USER_FAR(
            spotName + ' · ' + closestUser.point.name,
            closestUser.distanceMeters,
            closestUser.allowedRadius
          );
          errorItems.push(userErr);
          reasons.push('[' + userErr.title + '] ' + userErr.message);
        }

        if (!photoMatches.length || userMatches.length) {
          var photoErr = ERROR_MESSAGES.PHOTO_FAR(
            spotName + ' · ' + closestPhoto.point.name,
            closestPhoto.distanceMeters,
            closestPhoto.allowedRadius,
            userMatches.length > 0 && photoMatches.length > 0
          );
          errorItems.push(photoErr);
          reasons.push('[' + photoErr.title + '] ' + photoErr.message);
        }
      }
    }

    // GPS 정보가 없거나 파싱에 실패한 경우에도 사용자 위치 이탈을 함께 안내합니다.
    if (!userMatches.length && !photoGps && !photoParseError) {
      var noUserMatchErr = ERROR_MESSAGES.USER_FAR(
        spotName + ' · ' + closestUser.point.name,
        closestUser.distanceMeters,
        closestUser.allowedRadius
      );
      errorItems.push(noUserMatchErr);
      reasons.push('[' + noUserMatchErr.title + '] ' + noUserMatchErr.message);
    }
    if (!userMatches.length && photoParseError) {
      var parseUserErr = ERROR_MESSAGES.USER_FAR(
        spotName + ' · ' + closestUser.point.name,
        closestUser.distanceMeters,
        closestUser.allowedRadius
      );
      errorItems.push(parseUserErr);
      reasons.push('[' + parseUserErr.title + '] ' + parseUserErr.message);
    }

    return {
      isValid: errorItems.length === 0 && Boolean(details.pointId),
      pointId: details.pointId,
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
