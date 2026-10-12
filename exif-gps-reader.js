/**
 * exif-gps-reader.js
 * JPEG/TIFF 이미지 파일에서 EXIF GPS 좌표와 촬영 시각(DateTimeOriginal)을 추출합니다.
 * 일반 스크립트 방식이며 공개 API는 globalThis.ExifGpsReader에서 사용할 수 있습니다.
 */
(function (global) {
  'use strict';

  async function extractMetadataFromImage(file) {
    try {
      const buffer = await file.arrayBuffer();
      const dataView = new DataView(buffer);
      if (dataView.byteLength < 4 || dataView.getUint16(0, false) !== 0xFFD8) {
        return { success: false, reason: 'JPEG 형식이 아니거나 손상된 파일입니다.', takenAt: null };
      }

      let offset = 2;
      while (offset + 4 <= dataView.byteLength) {
        // JPEG 마커 앞의 패딩 바이트를 건너뜁니다.
        while (offset < dataView.byteLength && dataView.getUint8(offset) !== 0xFF) offset++;
        while (offset < dataView.byteLength && dataView.getUint8(offset) === 0xFF) offset++;
        if (offset >= dataView.byteLength) break;

        const marker = dataView.getUint8(offset++);
        if (marker === 0xD9 || marker === 0xDA) break;
        if (marker >= 0xD0 && marker <= 0xD7) continue;
        if (offset + 2 > dataView.byteLength) break;

        const segmentLength = dataView.getUint16(offset, false);
        if (segmentLength < 2 || offset + segmentLength > dataView.byteLength) break;
        const payloadStart = offset + 2;

        if (marker === 0xE1 && segmentLength >= 8) {
          const header = String.fromCharCode(
            dataView.getUint8(payloadStart),
            dataView.getUint8(payloadStart + 1),
            dataView.getUint8(payloadStart + 2),
            dataView.getUint8(payloadStart + 3)
          );
          if (header === 'Exif' && dataView.getUint16(payloadStart + 4, false) === 0) {
            const tiffStart = payloadStart + 6;
            const parsed = parseTiffMetadata(dataView, tiffStart);
            if (parsed) {
              if (parsed.latitude !== null && parsed.longitude !== null) {
                return { success: true, ...parsed };
              }
              return {
                success: false,
                reason: '사진에 GPS 위치 정보가 포함되어 있지 않습니다.',
                takenAt: parsed.takenAt || null
              };
            }
          }
        }
        offset += segmentLength;
      }

      return { success: false, reason: '사진에 EXIF 메타데이터가 없습니다.', takenAt: null };
    } catch (error) {
      return { success: false, reason: `사진 메타데이터 추출 중 오류 발생: ${error.message}`, takenAt: null };
    }
  }

  function parseTiffMetadata(dataView, tiffStart) {
    if (tiffStart + 8 > dataView.byteLength) return null;
    const byteOrder = dataView.getUint16(tiffStart, false);
    if (byteOrder !== 0x4949 && byteOrder !== 0x4D4D) return null;
    const littleEndian = byteOrder === 0x4949;
    if (dataView.getUint16(tiffStart + 2, littleEndian) !== 42) return null;

    const firstIfdOffset = dataView.getUint32(tiffStart + 4, littleEndian);
    const ifd0 = readIfdEntries(dataView, tiffStart, firstIfdOffset, littleEndian);
    if (!ifd0) return null;

    let gpsOffset = null;
    let exifOffset = null;
    for (const entry of ifd0) {
      if (entry.tag === 0x8825) gpsOffset = readEntryLong(dataView, tiffStart, entry, littleEndian);
      else if (entry.tag === 0x8769) exifOffset = readEntryLong(dataView, tiffStart, entry, littleEndian);
    }

    let originalDate = null;
    let subsecond = null;
    let offsetTime = null;
    if (exifOffset !== null) {
      const exifIfd = readIfdEntries(dataView, tiffStart, exifOffset, littleEndian) || [];
      for (const entry of exifIfd) {
        if (entry.tag === 0x9003) originalDate = readAsciiEntry(dataView, tiffStart, entry, littleEndian);
        else if (entry.tag === 0x9291) subsecond = readAsciiEntry(dataView, tiffStart, entry, littleEndian);
        else if (entry.tag === 0x9011) offsetTime = readAsciiEntry(dataView, tiffStart, entry, littleEndian);
      }
    }

    // DateTimeOriginal만 촬영 시각으로 사용합니다. 일반 DateTime은 파일 수정 시각일 수 있습니다.
    const takenAt = parseExifDateTime(originalDate, subsecond, offsetTime);
    const coordinates = gpsOffset === null
      ? { latitude: null, longitude: null }
      : parseGpsIfd(dataView, tiffStart, gpsOffset, littleEndian);

    return { ...coordinates, takenAt };
  }

  function readIfdEntries(dataView, tiffStart, relativeOffset, littleEndian) {
    const ifdOffset = tiffStart + relativeOffset;
    if (ifdOffset + 2 > dataView.byteLength) return null;
    const count = dataView.getUint16(ifdOffset, littleEndian);
    if (ifdOffset + 2 + count * 12 > dataView.byteLength) return null;
    const entries = [];
    for (let i = 0; i < count; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      entries.push({
        offset: entryOffset,
        tag: dataView.getUint16(entryOffset, littleEndian),
        type: dataView.getUint16(entryOffset + 2, littleEndian),
        count: dataView.getUint32(entryOffset + 4, littleEndian)
      });
    }
    return entries;
  }

  function readEntryLong(dataView, tiffStart, entry, littleEndian) {
    if (entry.type === 4 || entry.type === 9) return dataView.getUint32(entry.offset + 8, littleEndian);
    if (entry.type === 3) return dataView.getUint16(entry.offset + 8, littleEndian);
    return null;
  }

  function getEntryDataOffset(dataView, tiffStart, entry, littleEndian) {
    const byteLength = entry.type === 2 ? entry.count : entry.count * 4;
    if (byteLength <= 4) return entry.offset + 8;
    return tiffStart + dataView.getUint32(entry.offset + 8, littleEndian);
  }

  function readAsciiEntry(dataView, tiffStart, entry, littleEndian) {
    if (entry.type !== 2 || !entry.count) return null;
    const valueOffset = getEntryDataOffset(dataView, tiffStart, entry, littleEndian);
    if (valueOffset < 0 || valueOffset + entry.count > dataView.byteLength) return null;
    let value = '';
    for (let i = 0; i < entry.count; i++) {
      const code = dataView.getUint8(valueOffset + i);
      if (code === 0) break;
      value += String.fromCharCode(code);
    }
    return value.trim() || null;
  }

  function parseExifDateTime(dateText, subsecond, offsetText) {
    if (!dateText) return null;
    const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(dateText.trim());
    if (!match) return null;
    const [, year, month, day, hour, minute, second] = match;
    const milliseconds = subsecond ? Number(`0.${subsecond.replace(/\D/g, '').slice(0, 3).padEnd(3, '0')}`) * 1000 : 0;
    let date;
    if (offsetText && /^[+-]\d{2}:?\d{2}$/.test(offsetText.trim())) {
      const normalizedOffset = offsetText.trim().replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
      date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${String(Math.floor(milliseconds)).padStart(3, '0')}${normalizedOffset}`);
    } else {
      date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Math.floor(milliseconds));
      if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
    }
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function parseGpsIfd(dataView, tiffStart, relativeOffset, littleEndian) {
    const entries = readIfdEntries(dataView, tiffStart, relativeOffset, littleEndian);
    if (!entries) return { latitude: null, longitude: null };
    let latRef = 'N';
    let lonRef = 'E';
    let latDms = null;
    let lonDms = null;

    for (const entry of entries) {
      const valueOffset = getEntryDataOffset(dataView, tiffStart, entry, littleEndian);
      if (entry.tag === 0x0001 && valueOffset < dataView.byteLength) {
        latRef = String.fromCharCode(dataView.getUint8(valueOffset));
      } else if (entry.tag === 0x0002) {
        latDms = readRationalCoordinates(dataView, valueOffset, littleEndian);
      } else if (entry.tag === 0x0003 && valueOffset < dataView.byteLength) {
        lonRef = String.fromCharCode(dataView.getUint8(valueOffset));
      } else if (entry.tag === 0x0004) {
        lonDms = readRationalCoordinates(dataView, valueOffset, littleEndian);
      }
    }

    if (!latDms || !lonDms) return { latitude: null, longitude: null };
    let latitude = convertDmsToDecimal(latDms);
    let longitude = convertDmsToDecimal(lonDms);
    if (latRef === 'S') latitude = -latitude;
    if (lonRef === 'W') longitude = -longitude;
    return { latitude, longitude };
  }

  function readRationalCoordinates(dataView, offset, littleEndian) {
    if (offset < 0 || offset + 24 > dataView.byteLength) return null;
    const values = [];
    for (let i = 0; i < 3; i++) {
      const numerator = dataView.getUint32(offset + i * 8, littleEndian);
      const denominator = dataView.getUint32(offset + i * 8 + 4, littleEndian);
      values.push(denominator === 0 ? 0 : numerator / denominator);
    }
    return values;
  }

  function convertDmsToDecimal(dms) {
    return dms[0] + dms[1] / 60 + dms[2] / 3600;
  }

  async function extractGpsFromImage(file) {
    const result = await extractMetadataFromImage(file);
    if (!result.success) return result;
    return result;
  }

  // upload-validator.js 호환 API: 좌표가 있으면 반환하고, 없으면 null을 반환합니다.
  async function extractGpsCoordinates(file) {
    const result = await extractMetadataFromImage(file);
    if (!result.success) return null;
    return {
      latitude: result.latitude,
      longitude: result.longitude,
      takenAt: result.takenAt || null
    };
  }

  async function extractDateTimeOriginal(file) {
    const result = await extractMetadataFromImage(file);
    return result.takenAt || null;
  }

  global.ExifGpsReader = Object.freeze({
    extractGpsFromImage,
    extractGpsCoordinates,
    extractMetadataFromImage,
    extractDateTimeOriginal
  });
})(globalThis);
