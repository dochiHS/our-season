/**
 * 청주 촬영 명소 기본 데이터셋 및 상태 관리
 * 일반 스크립트 방식이며 공개 API는 globalThis.SpotData에서 사용할 수 있습니다.
 *
 * 계층 구조:
 * 명소(Spot) -> 촬영 지점(Point, 현재는 명소별 대표 위치 1개) -> 계절 4개 x 날씨/빛 4개 격자 슬롯
 *
 * 명소별 운영정보:
 * - operatingHours: 운영시간
 * - parking: 주차 정보 ('주차 가능' 등 확인된 정보만 유지, 세부 내용은 현장 실사 후 보완)
 * - safetyNotice: 출사 주의 메모 (수암골 야간 정숙 등 확인된 내용만 유지)
 */
(function (global) {
  'use strict';

  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const SEASONS_KO = {
    spring: '봄',
    summer: '여름',
    autumn: '가을',
    winter: '겨울'
  };

  const LIGHT_CONDITIONS = ['sunrise', 'clear', 'sunset', 'rain'];
  const LIGHT_CONDITIONS_KO = {
    sunrise: '일출',
    clear: '맑음',
    sunset: '일몰',
    rain: '비'
  };

  /** 오늘 날짜(KST)의 달력 계절을 반환합니다. */
  function getCurrentSeason(date = new Date()) {
    const month = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      month: 'numeric'
    }).format(date));

    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
  }

  /** 기본 4x4 슬롯 빈 템플릿 생성 */
  function createEmptyGrid() {
    const grid = {};
    for (const season of SEASONS) {
      grid[season] = {};
      for (const light of LIGHT_CONDITIONS) {
        grid[season][light] = [];
      }
    }
    return grid;
  }

  const CHEONGJU_SPOTS = [
    {
      id: 'jungbuk-dong',
      name: '정북동토성',
      description: '광활한 하늘과 나홀로나무 실루엣이 어우러지는 인생샷 명소',
      operatingHours: '상시 개방',
      parking: '주차 가능',
      safetyNotice: '현장 확인 예정',
      points: [
        {
          id: 'jungbuk-main',
          name: '대표 위치',
          lat: 36.6889,
          lng: 127.4554,
          radiusMeters: 500,
          grid: createEmptyGrid()
        }
      ]
    },
    {
      id: 'sangdang-sanseong',
      name: '상당산성',
      description: '조선시대 석축산성으로 사계절 피크닉과 산책 명소',
      operatingHours: '상시 개방',
      parking: '주차 가능',
      safetyNotice: '현장 확인 예정',
      points: [
        {
          id: 'sangdang-main',
          name: '대표 위치 (남문/성벽)',
          lat: 36.6619,
          lng: 127.5384,
          radiusMeters: 500,
          grid: createEmptyGrid()
        }
      ]
    },
    {
      id: 'suamgol',
      name: '수암골 전망대',
      description: '청주 시내가 한눈에 내려다보이는 야경 및 일몰 명소',
      operatingHours: '상시 개방',
      parking: '주차 가능',
      safetyNotice: '주거 지역이라 밤 9시 이후 방문 자제',
      points: [
        {
          id: 'suamgol-main',
          name: '대표 위치 (수암골 전망대)',
          lat: 36.6464,
          lng: 127.4955,
          radiusMeters: 500,
          grid: createEmptyGrid()
        }
      ]
    }
  ];

  /**
   * SunCalc로 오늘의 일출·일몰 시각을 계산하고 한국 표준시로 표시합니다.
   * @param {number} lat 위도
   * @param {number} lng 경도
   * @param {Date} [date=new Date()] 기준 시점. 해당 시점의 한국 날짜를 사용합니다.
   * @returns {{ sunrise: string, sunset: string }} 'HH:MM' 형식의 한국 표준시(KST) 시각
   */
  function getSunTimes(lat, lng, date = new Date()) {
    if (!global.SunCalc || typeof global.SunCalc.getTimes !== 'function') {
      return { sunrise: '--:--', sunset: '--:--' };
    }

    const kstDateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const dateParts = Object.fromEntries(kstDateParts.map(part => [part.type, part.value]));

    // SunCalc는 전달된 Date의 날짜 경계를 사용합니다. KST 자정(전날 15:00 UTC)을 넘깁니다.
    const kstMidnight = new Date(Date.UTC(
      Number(dateParts.year),
      Number(dateParts.month) - 1,
      Number(dateParts.day),
      -9
    ));
    const times = global.SunCalc.getTimes(kstMidnight, lat, lng);

    const formatKstTime = value => {
      if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '--:--';
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(value);
    };

    return {
      sunrise: formatKstTime(times.sunrise),
      sunset: formatKstTime(times.sunset)
    };
  }

  const STORAGE_KEY = 'cheongju_spots_custom_photos_v2';

  /** 로컬스토리지에 저장된 사용자 추가 사진을 명소/지점/격자 슬롯에 병합하여 반환 */
  function getAllSpots() {
    const customPhotos = getCustomPhotos();

    return CHEONGJU_SPOTS.map(spot => {
      const points = spot.points.map(point => {
        const grid = createEmptyGrid();

        for (const season of SEASONS) {
          for (const light of LIGHT_CONDITIONS) {
            grid[season][light] = [...(point.grid[season]?.[light] || [])];
          }
        }

        customPhotos
          .filter(photo => photo.spotId === spot.id && (!photo.pointId || photo.pointId === point.id))
          .forEach(photo => {
            if (grid[photo.season] && grid[photo.season][photo.lightCondition]) {
              grid[photo.season][photo.lightCondition].push(photo);
            }
          });

        return { ...point, grid };
      });

      const sunTimes = getSunTimes(points[0].lat, points[0].lng);
      return { ...spot, sunTimes, points };
    });
  }

  /** 사용자 좌표가 있으면 명소를 가까운 순으로 반환 */
  function getSpotsSortedByDistance(userCoords = null) {
    const spots = getAllSpots();

    if (!userCoords || typeof userCoords.lat !== 'number' || typeof userCoords.lng !== 'number') {
      return spots.map(spot => ({ ...spot, distanceMeters: null, distanceText: null }));
    }

    return spots
      .map(spot => {
        const repPoint = spot.points[0];
        const distanceMeters = calculateDistanceMeters(
          userCoords.lat,
          userCoords.lng,
          repPoint.lat,
          repPoint.lng
        );
        const distanceText = distanceMeters < 1000
          ? `${Math.round(distanceMeters)}m`
          : `${(distanceMeters / 1000).toFixed(1)}km`;

        return { ...spot, distanceMeters, distanceText };
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  /** 특정 ID의 명소 정보 반환 */
  function getSpotById(spotId) {
    const spots = getAllSpots();
    return spots.find(spot => spot.id === spotId) || null;
  }

  /** 검증 완료된 새 사진을 명소/지점의 계절x빛 슬롯에 저장 */
  function addPhotoToSpot(spotId, pointId, photoData) {
    const spot = CHEONGJU_SPOTS.find(item => item.id === spotId);
    const targetPointId = pointId || (spot && spot.points[0]?.id) || 'main';
    const existing = getCustomPhotos();
    const newEntry = {
      ...photoData,
      id: `custom-${Date.now()}`,
      spotId,
      pointId: targetPointId,
      season: photoData.season,
      lightCondition: photoData.lightCondition,
      uploadedAt: new Date().toISOString().slice(0, 10)
    };

    const updated = [newEntry, ...existing];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error('로컬스토리지 저장 실패:', err);
    }
    return newEntry;
  }

  function getCustomPhotos() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (err) {
      return [];
    }
  }

  // Haversine 공식으로 두 좌표 사이의 거리를 미터 단위로 계산
  function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
    const earthRadiusMeters = 6371000;
    const toRadians = degrees => (degrees * Math.PI) / 180;
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLng = toRadians(lng2 - lng1);
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
    return Math.round(earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  // 다른 일반 스크립트에서는 SpotData 네임스페이스를 통해 사용
  global.SpotData = Object.freeze({
    SEASONS,
    SEASONS_KO,
    LIGHT_CONDITIONS,
    LIGHT_CONDITIONS_KO,
    CHEONGJU_SPOTS,
    getCurrentSeason,
    getSunTimes,
    getAllSpots,
    getSpotsSortedByDistance,
    getSpotById,
    addPhotoToSpot
  });
})(globalThis);
