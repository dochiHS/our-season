/**
 * 청주 촬영 명소 기본 데이터셋 및 상태 관리
 * 일반 스크립트 방식이며 공개 API는 globalThis.SpotData에서 사용할 수 있습니다.
 *
 * 계층 구조:
 * 명소(Spot) -> 촬영 지점(Point, 명소마다 여러 지점을 둘 수 있음) -> 계절 4개 x 시간대 4개 격자 슬롯
 * 각 지점은 id, name, lat, lng, radiusMeters, description을 가집니다.
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

  const TIME_OF_DAY = ['sunrise', 'day', 'sunset', 'night'];
  const TIME_OF_DAY_KO = {
    sunrise: '일출',
    day: '낮',
    sunset: '일몰',
    night: '밤'
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
      for (const timeOfDay of TIME_OF_DAY) {
        grid[season][timeOfDay] = [];
      }
    }
    return grid;
  }

  const CHEONGJU_SPOTS = [
    {
      id: 'jungbuk-dong',
      name: '정북동토성',
      description: '넓은 평지 위 토성과 하늘이 어우러지는 명소',
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
          description: '정북동토성 대표 촬영 지점',
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
          id: 'sangdang-gongnam',
          name: '공남문',
          lat: 36.66154,
          lng: 127.54051,
          radiusMeters: 200,
          description: '공남문 앞 길과 누각 위',
          grid: createEmptyGrid()
        },
        {
          id: 'sangdang-west-ridge',
          name: '서쪽 성곽 능선',
          lat: 36.660964,
          lng: 127.536471,
          radiusMeters: 200,
          description: '청주 시내가 보이는 성곽길',
          grid: createEmptyGrid()
        },
        {
          id: 'sangdang-main',
          name: '산성 안 다른 곳',
          lat: 36.6619,
          lng: 127.5384,
          radiusMeters: 500,
          description: '그 밖의 산성 안 위치',
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
          description: '수암골 전망대 대표 촬영 지점',
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

  /** 명소와 빈 격자 정보를 반환합니다. 사진 데이터는 Supabase에서 가져옵니다. */
  function getAllSpots() {
    return CHEONGJU_SPOTS.map(spot => {
      const points = spot.points.map(point => ({
        ...point,
        grid: createEmptyGrid()
      }));
      const sunPoint = points[0];
      const sunTimes = sunPoint ? getSunTimes(sunPoint.lat, sunPoint.lng) : { sunrise: '--:--', sunset: '--:--' };
      return { ...spot, sunTimes, points };
    });
  }

  /** 사용자 좌표가 있으면 명소를 가장 가까운 지점 순으로 반환 */
  function getSpotsSortedByDistance(userCoords = null) {
    const spots = getAllSpots();

    if (!userCoords || typeof userCoords.lat !== 'number' || typeof userCoords.lng !== 'number') {
      return spots.map(spot => ({
        ...spot,
        nearestPoint: null,
        nearestPointId: null,
        distanceMeters: null,
        distanceText: null
      }));
    }

    return spots
      .map(spot => {
        const pointDistances = spot.points
          .map(point => ({
            point,
            distanceMeters: calculateDistanceMeters(
              userCoords.lat,
              userCoords.lng,
              point.lat,
              point.lng
            )
          }))
          .sort((a, b) => a.distanceMeters - b.distanceMeters);
        const nearest = pointDistances[0] || null;
        const distanceMeters = nearest ? nearest.distanceMeters : null;
        const distanceText = distanceMeters === null
          ? null
          : distanceMeters < 1000
            ? `${Math.round(distanceMeters)}m`
            : `${(distanceMeters / 1000).toFixed(1)}km`;

        return {
          ...spot,
          nearestPoint: nearest ? nearest.point : null,
          nearestPointId: nearest ? nearest.point.id : null,
          distanceMeters,
          distanceText
        };
      })
      .sort((a, b) => {
        if (a.distanceMeters === null) return 1;
        if (b.distanceMeters === null) return -1;
        return a.distanceMeters - b.distanceMeters;
      });
  }

  /** 특정 ID의 명소 정보 반환 */
  function getSpotById(spotId) {
    const spots = getAllSpots();
    return spots.find(spot => spot.id === spotId) || null;
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
    TIME_OF_DAY,
    TIME_OF_DAY_KO,
    CHEONGJU_SPOTS,
    getCurrentSeason,
    getSunTimes,
    getAllSpots,
    getSpotsSortedByDistance,
    getSpotById
  });
})(globalThis);
