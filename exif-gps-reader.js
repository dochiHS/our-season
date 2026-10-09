/**
 * exif-gps-reader.js
 * JPEG/TIFF 이미지 파일의 바이너리 버퍼에서 EXIF GPS 위도/경도를 직접 추출하는 가벼운 유틸리티
 * 일반 스크립트 방식이며 공개 API는 globalThis.ExifGpsReader에서 사용할 수 있습니다.
 */
(function (global) {
  'use strict';

  // EXIF 바이너리 파서
  async function extractGpsFromImage(file) {
    try {
      const buffer = await file.arrayBuffer();
      const dataView = new DataView(buffer);

      // JPEG SOI 마커(0xFFD8) 확인
      if (dataView.getUint16(0, false) !== 0xFFD8) {
        return { success: false, reason: 'JPEG 형식이 아니거나 손상된 파일입니다.' };
      }

      let offset = 2;
      const length = dataView.byteLength;

      while (offset < length) {
        const marker = dataView.getUint16(offset, false);
        offset += 2;

        // APP1 마커 (0xFFE1: EXIF)
        if (marker === 0xFFE1) {
          const app1Length = dataView.getUint16(offset, false);
          const exifHeader = String.fromCharCode(
            dataView.getUint8(offset + 2),
            dataView.getUint8(offset + 3),
            dataView.getUint8(offset + 4),
            dataView.getUint8(offset + 5)
          );

          if (exifHeader === 'Exif') {
            const tiffStart = offset + 8;
            return parseTiffForGps(dataView, tiffStart);
          }
          offset += app1Length;
        } else if ((marker & 0xFF00) === 0xFF00) {
          // 일반 마커 통과
          const sectionLength = dataView.getUint16(offset, false);
          offset += sectionLength;
        } else {
          break;
        }
      }

      return { success: false, reason: '사진에 EXIF 메타데이터가 없습니다.' };
    } catch (error) {
      return { success: false, reason: `위치 정보 추출 중 오류 발생: ${error.message}` };
    }
  }

  function parseTiffForGps(dataView, tiffStart) {
    const byteOrderMarker = dataView.getUint16(tiffStart, false);
    const isLittleEndian = byteOrderMarker === 0x4949; // 'II'

    const firstIfdOffset = dataView.getUint32(tiffStart + 4, isLittleEndian);
    const ifdOffset = tiffStart + firstIfdOffset;
    const numEntries = dataView.getUint16(ifdOffset, isLittleEndian);

    let gpsInfoOffset = null;

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      const tag = dataView.getUint16(entryOffset, isLittleEndian);

      // GPS IFD Pointer 태그: 0x8825
      if (tag === 0x8825) {
        gpsInfoOffset = dataView.getUint32(entryOffset + 8, isLittleEndian);
        break;
      }
    }

    if (!gpsInfoOffset) {
      return { success: false, reason: '사진에 GPS 위치 정보가 포함되어 있지 않습니다.' };
    }

    const gpsIfd = tiffStart + gpsInfoOffset;
    const gpsEntries = dataView.getUint16(gpsIfd, isLittleEndian);

    let latRef = 'N';
    let lonRef = 'E';
    let latDms = null;
    let lonDms = null;

    for (let i = 0; i < gpsEntries; i++) {
      const entryOffset = gpsIfd + 2 + i * 12;
      const tag = dataView.getUint16(entryOffset, isLittleEndian);

      if (tag === 0x0001) { // GPSLatitudeRef
        latRef = String.fromCharCode(dataView.getUint8(entryOffset + 8));
      } else if (tag === 0x0002) { // GPSLatitude
        const valOffset = tiffStart + dataView.getUint32(entryOffset + 8, isLittleEndian);
        latDms = readRationalCoordinates(dataView, valOffset, isLittleEndian);
      } else if (tag === 0x0003) { // GPSLongitudeRef
        lonRef = String.fromCharCode(dataView.getUint8(entryOffset + 8));
      } else if (tag === 0x0004) { // GPSLongitude
        const valOffset = tiffStart + dataView.getUint32(entryOffset + 8, isLittleEndian);
        lonDms = readRationalCoordinates(dataView, valOffset, isLittleEndian);
      }
    }

    if (latDms && lonDms) {
      let lat = convertDmsToDecimal(latDms);
      let lon = convertDmsToDecimal(lonDms);

      if (latRef === 'S') lat = -lat;
      if (lonRef === 'W') lon = -lon;

      return {
        success: true,
        latitude: lat,
        longitude: lon
      };
    }

    return { success: false, reason: '사진의 GPS 좌표를 읽을 수 없습니다.' };
  }

  function readRationalCoordinates(dataView, offset, isLittleEndian) {
    const values = [];
    for (let i = 0; i < 3; i++) {
      const num = dataView.getUint32(offset + i * 8, isLittleEndian);
      const den = dataView.getUint32(offset + i * 8 + 4, isLittleEndian);
      values.push(den === 0 ? 0 : num / den);
    }
    return values;
  }

  function convertDmsToDecimal(dms) {
    return dms[0] + dms[1] / 60 + dms[2] / 3600;
  }

  // upload-validator.js 호환 API: 좌표가 있으면 반환하고, 없으면 null을 반환합니다.
  async function extractGpsCoordinates(file) {
    const result = await extractGpsFromImage(file);
    if (!result.success) return null;
    return {
      latitude: result.latitude,
      longitude: result.longitude
    };
  }

  global.ExifGpsReader = Object.freeze({
    extractGpsFromImage,
    extractGpsCoordinates
  });
})(globalThis);
