/**
 * image-compressor.js
 * 
 * 브라우저 Canvas API를 활용한 클라이언트 측 이미지 압축/리사이징 유틸리티.
 * 스마트폰 원본 사진(3~10MB)을 100~150KB 수준으로 가볍게 압축하여
 * 로컬 스토리지(5MB 한도)에 안전하게 다량 저장할 수 있도록 지원합니다.
 * 
 * 일반 스크립트 방식이며 공개 API는 globalThis.ImageCompressor에서 사용할 수 있습니다.
 * *주의*: 위치(EXIF GPS) 검증은 반드시 원본 File 객체 상태에서 먼저 완료한 후
 * 이 압축 함수를 호출해야 합니다. (Canvas 재인코딩 시 EXIF가 제거됨)
 */

(function (global) {
  'use strict';

  var DEFAULT_OPTIONS = {
    maxWidth: 1000,       // 긴 축 최대 해상도(px)
    maxHeight: 1000,      // 긴 축 최대 해상도(px)
    quality: 0.75,        // JPEG 압축 품질 (0.0 ~ 1.0)
    mimeType: 'image/jpeg'
  };

  /**
   * File 또는 Blob 객체를 브라우저 Image 엘리먼트로 로드
   * @param {Blob|File} file
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);

      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = function (err) {
        URL.revokeObjectURL(url);
        reject(new Error('이미지 파일을 읽을 수 없습니다: ' + (err.message || '알 수 없는 형식')));
      };

      img.src = url;
    });
  }

  /**
   * 비율을 유지하면서 목표 최대 크기 안에 들어오도록 해상도 계산
   * @param {number} width 
   * @param {number} height 
   * @param {number} maxWidth 
   * @param {number} maxHeight 
   * @returns {{width: number, height: number}}
   */
  function calculateDimensions(width, height, maxWidth, maxHeight) {
    var targetWidth = width;
    var targetHeight = height;

    if (width > maxWidth || height > maxHeight) {
      var widthRatio = maxWidth / width;
      var heightRatio = maxHeight / height;
      var ratio = Math.min(widthRatio, heightRatio);

      targetWidth = Math.round(width * ratio);
      targetHeight = Math.round(height * ratio);
    }

    return {
      width: targetWidth,
      height: targetHeight
    };
  }

  /**
   * 이미지 파일 압축 실행
   * @param {File|Blob} file - 압축할 이미지 파일 (JPEG, PNG 등)
   * @param {Object} [customOptions] - 압축 옵션 오버라이드
   * @returns {Promise<{
   *   dataUrl: string,
   *   blob: Blob,
   *   originalSize: number,
   *   compressedSize: number,
   *   width: number,
   *   height: number
   * }>}
   */
  function compressImage(file, customOptions) {
    var options = Object.assign({}, DEFAULT_OPTIONS, customOptions || {});

    if (!file || !(file instanceof Blob)) {
      return Promise.reject(new Error('유효한 이미지 파일(Blob/File)이 아닙니다.'));
    }

    var originalSize = file.size;

    return loadImage(file).then(function (img) {
      var dims = calculateDimensions(img.naturalWidth, img.naturalHeight, options.maxWidth, options.maxHeight);

      var canvas = document.createElement('canvas');
      canvas.width = dims.width;
      canvas.height = dims.height;

      var ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D Context를 초기화할 수 없습니다.');
      }

      // 캔버스에 리사이징 렌더링
      ctx.drawImage(img, 0, 0, dims.width, dims.height);

      // DataURL(Base64) 추출
      var dataUrl = canvas.toDataURL(options.mimeType, options.quality);

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) {
            reject(new Error('Canvas 이미지를 Blob으로 변환하지 못했습니다.'));
            return;
          }

          resolve({
            dataUrl: dataUrl,
            blob: blob,
            originalSize: originalSize,
            compressedSize: blob.size,
            width: dims.width,
            height: dims.height,
            compressionRatio: Math.round((blob.size / originalSize) * 100) + '%'
          });
        }, options.mimeType, options.quality);
      });
    });
  }

  global.ImageCompressor = Object.freeze({
    compressImage: compressImage,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS
  });
})(globalThis);
