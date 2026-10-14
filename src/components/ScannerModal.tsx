'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface ScannedBatchItem {
  code: string;
  photo?: string;
  format?: string;
  timestamp: number;
}

export interface ScannerTelemetry {
  cameraOpenMs: number | null;
  wasmInitMs: number | null;
  cropTimeMs: number;
  decodeTimeMs: number;
  timeToDetectMs: number | null;
  actualResolution: string;
  cameraLabel: string;
  fps: number;
  totalFramesScanned: number;
  activeGear: 'fast' | 'deep';
}

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (code: string, photoDataUrl?: string) => void;
  onBatchDetected?: (items: ScannedBatchItem[]) => void;
  title?: string;
  allowManual?: boolean;
}

// ─── THÔNG TIN ENGINE ZXING C++ WASM THỰC TẾ ───────────────────────────────
// Package: zxing-wasm (v3.1.5)
// Module: zxing-wasm/reader (Reader-only build từ zxing-cpp qua Emscripten)
// Lưu ý: "Turbo" trước đây chỉ là nhãn UI. Thực tế engine là zxing-cpp compiled to WebAssembly.
export const ZXING_ENGINE_INFO = {
  package: 'zxing-wasm',
  version: '3.1.5',
  flavor: 'reader-only (zxing-cpp WebAssembly)',
  wasmFile: '/zxing_reader.wasm (944 KB)',
};

// Toàn bộ định dạng Barcode phần cứng, linh kiện, bao bì & mã QR
const ALL_COMMON_FORMATS: any[] = [
  'Code128',
  'Code39',
  'Code93',
  'Codabar',
  'EAN13',
  'EAN8',
  'UPCA',
  'UPCE',
  'ITF',
  'QRCode',
  'DataMatrix',
  'PDF417',
  'Aztec',
];
// Định dạng tối ưu cho Serial máy tính & mã kho (7 định dạng cốt lõi - tiết kiệm 50% CPU/RAM)
const HARDWARE_SERIAL_FORMATS: any[] = [
  'Code128',
  'Code39',
  'QRCode',
  'DataMatrix',
  'EAN13',
  'EAN8',
  'UPCA',
];
const ALL_FORMATS: any[] = ALL_COMMON_FORMATS;

// Hardware-accelerated Native BarcodeDetector (Chrome Android, Edge, iOS Safari 17+)
let nativeBarcodeDetector: any = null;
if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
  try {
    const BD = (window as any).BarcodeDetector;
    nativeBarcodeDetector = new BD({
      formats: [
        'code_128',
        'code_39',
        'code_93',
        'codabar',
        'ean_13',
        'ean_8',
        'upc_a',
        'upc_e',
        'itf',
        'qr_code',
        'data_matrix',
        'pdf417',
        'aztec',
      ],
    });
  } catch {
    try {
      nativeBarcodeDetector = new (window as any).BarcodeDetector();
    } catch {}
  }
}

// ─── Module-level WASM Pre-warming (Khởi tạo duy nhất 1 lần trong RAM) ─────
let cachedZxingReader: ((imageData: ImageData, options?: any) => Promise<any[]>) | null = null;
let cachedReadBarcodes: ((input: any, options?: any) => Promise<any[]>) | null = null;
let wasmInitDurationMs: number | null = null;
let isPreloadingWasm = false;

async function getOrPreloadWasm() {
  if (cachedZxingReader && cachedReadBarcodes) {
    return {
      readBarcodesFromImageData: cachedZxingReader,
      readBarcodes: cachedReadBarcodes,
      initDurationMs: wasmInitDurationMs,
    };
  }

  if (isPreloadingWasm) {
    while (isPreloadingWasm) {
      await new Promise((r) => setTimeout(r, 15));
    }
    return {
      readBarcodesFromImageData: cachedZxingReader!,
      readBarcodes: cachedReadBarcodes!,
      initDurationMs: wasmInitDurationMs,
    };
  }

  isPreloadingWasm = true;
  const tStart = performance.now();

  try {
    const zxing = await import('zxing-wasm/reader');
    if (zxing.prepareZXingModule) {
      zxing.prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => {
            if (path.endsWith('.wasm')) return '/zxing_reader.wasm';
            return prefix + path;
          },
        },
      });
    }

    // Pre-warm JIT engine với bảng giải mã serial thật
    try {
      const dummy = new ImageData(16, 16);
      await zxing.readBarcodesFromImageData(dummy, {
        formats: HARDWARE_SERIAL_FORMATS,
        tryHarder: false,
        tryRotate: true,
        binarizer: 'LocalAverage',
      });
    } catch {}

    cachedZxingReader = zxing.readBarcodesFromImageData;
    cachedReadBarcodes = zxing.readBarcodes;
    wasmInitDurationMs = Math.round(performance.now() - tStart);
  } catch (e) {
    console.warn('Lỗi khởi tạo WASM reader:', e);
  } finally {
    isPreloadingWasm = false;
  }

  return {
    readBarcodesFromImageData: cachedZxingReader!,
    readBarcodes: cachedReadBarcodes!,
    initDurationMs: wasmInitDurationMs,
  };
}

// Kích hoạt preload ngay khi module được nạp
if (typeof window !== 'undefined') {
  setTimeout(() => {
    getOrPreloadWasm();
  }, 40);
}

// Âm thanh bíp xác nhận tức thì (Web Audio API, 0ms latency)
function playScannerBeep() {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1760, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {}
}

export default function ScannerModal({
  isOpen,
  onClose,
  onDetected,
  onBatchDetected,
  title = 'Quét mã Barcode / QR',
  allowManual = true,
}: ScannerModalProps) {
  const [manualCode, setManualCode] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [isLoadingCamera, setIsLoadingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannedBatch, setScannedBatch] = useState<ScannedBatchItem[]>([]);
  const [continuousToast, setContinuousToast] = useState<string | null>(null);
  const [scanIdleSeconds, setScanIdleSeconds] = useState<number>(0);

  // Bộ chọn định dạng quét: Mặc định tối ưu cho tem Serial máy tính / linh kiện
  const [formatMode, setFormatMode] = useState<'serial' | 'all'>('serial');

  // Camera capabilities thực tế (chỉ hiện nút nếu phần cứng có hỗ trợ)
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [hasZoom, setHasZoom] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isHardwareZoomActive, setIsHardwareZoomActive] = useState<boolean>(false);
  const [zoomMinMax, setZoomMinMax] = useState<{ min: number; max: number; step: number }>({ min: 1, max: 2, step: 0.1 });
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState<number>(0);

  // Hiển thị bảng đo lường Telemetry (Đo độc lập từng công đoạn)
  const [showTelemetry, setShowTelemetry] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<ScannerTelemetry>({
    cameraOpenMs: null,
    wasmInitMs: null,
    cropTimeMs: 0,
    decodeTimeMs: 0,
    timeToDetectMs: null,
    actualResolution: '---',
    cameraLabel: '---',
    fps: 0,
    totalFramesScanned: 0,
    activeGear: 'fast',
  });

  // Refs điều khiển luồng & DOM
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const viewfinderBoxRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Cờ điều khiển decode in-flight (Tuyệt đối không xếp hàng frame cũ)
  const scanLoopActiveRef = useRef(false);
  const isDecodingRef = useRef(false);
  const isHandlingDetectionRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const lastDetectedCodeRef = useRef<{ code: string; timestamp: number } | null>(null);
  const zoomLevelRef = useRef<number>(1);
  const isHardwareZoomActiveRef = useRef<boolean>(false);
  const formatModeRef = useRef<'serial' | 'all'>('serial');
  formatModeRef.current = formatMode;

  // Timers đo lường độc lập
  const scanStartTimestampRef = useRef<number>(0);
  const metricsRef = useRef<ScannerTelemetry>({
    cameraOpenMs: null,
    wasmInitMs: null,
    cropTimeMs: 0,
    decodeTimeMs: 0,
    timeToDetectMs: null,
    actualResolution: '---',
    cameraLabel: '---',
    fps: 0,
    totalFramesScanned: 0,
    activeGear: 'fast',
  });
  const lastFpsTimeRef = useRef<number>(0);
  const framesInSecondRef = useRef<number>(0);
  const lastTelemetrySyncRef = useRef<number>(0);

  // Đếm giây idle cho hướng dẫn
  useEffect(() => {
    if (!cameraActive) {
      setScanIdleSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setScanIdleSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cameraActive]);

  // ─── Dừng camera & giải phóng tài nguyên ─────────────────────────────────
  const stopCamera = useCallback(() => {
    scanLoopActiveRef.current = false;
    isDecodingRef.current = false;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch {}
    }
    setCameraActive(false);
    setIsLoadingCamera(false);
    setIsTorchOn(false);
    setHasTorch(false);
    setHasZoom(false);
    zoomLevelRef.current = 1;
    isHardwareZoomActiveRef.current = false;
    setIsHardwareZoomActive(false);
    setZoomLevel(1);
    setContinuousToast(null);
  }, []);

  // ─── Xử lý khi phát hiện mã: Lưu chính xác ảnh dùng để decode ────────────
  const onCodeFound = useCallback(
    (code: string, format?: string, exactDecodedPhoto?: string) => {
      if (isHandlingDetectionRef.current) return;

      const trimmed = code.trim();
      if (!trimmed) return;

      // 1. Chống quét lặp lại liên tục cùng 1 mã khi người dùng đang giữ máy tại chỗ (cooldown 1.5s cho cùng 1 mã)
      const now = Date.now();
      if (
        lastDetectedCodeRef.current &&
        lastDetectedCodeRef.current.code.toLowerCase() === trimmed.toLowerCase() &&
        now - lastDetectedCodeRef.current.timestamp < 1500
      ) {
        return;
      }
      lastDetectedCodeRef.current = { code: trimmed, timestamp: now };

      isHandlingDetectionRef.current = true;
      setScanIdleSeconds(0);

      // Ghi nhận thời gian từ khi mã nằm rõ trong khung đến khi decode thành công
      const timeToDetect =
        scanStartTimestampRef.current > 0
          ? Math.round(performance.now() - scanStartTimestampRef.current)
          : null;

      metricsRef.current.timeToDetectMs = timeToDetect;
      setTelemetry({ ...metricsRef.current });

      // Âm thanh bíp tức thì & rung phản hồi
      playScannerBeep();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(100);
        } catch {}
      }

      setScannedBatch((prev) => {
        const exists = prev.some((item) => item.code.toLowerCase() === trimmed.toLowerCase());
        if (exists) {
          setContinuousToast(`⚠️ Đã có trong danh sách: ${trimmed}`);
          setTimeout(() => {
            setContinuousToast(null);
            scanStartTimestampRef.current = performance.now();
            isHandlingDetectionRef.current = false;
          }, 600);
          return prev;
        }

        const newItem: ScannedBatchItem = {
          code: trimmed,
          photo: exactDecodedPhoto || undefined,
          format: format || 'BARCODE',
          timestamp: Date.now(),
        };

        const updated = [newItem, ...prev];
        setContinuousToast(`✓ Đã quét: ${trimmed} (${updated.length} mã)`);

        // Cooldown siêu nhạy 350ms: Sẵn sàng quét mã tiếp theo
        setTimeout(() => {
          setContinuousToast(null);
          scanStartTimestampRef.current = performance.now();
          isHandlingDetectionRef.current = false;
        }, 350);

        return updated;
      });
    },
    []
  );

  // ─── TÍNH TOÁN VÙNG QUÉT ROI CHUẨN XÁC THEO KHUNG NGẮM (VIEWFINDER BOX) ───
  // Khóa chặt việc quét trong đúng khung viền trực quan trên màn hình
  // Kèm lề đệm an toàn 6% (Quiet Zone) để mã không bị hụt mép
  const calculateExactRoi = useCallback(() => {
    const video = videoRef.current;
    const container = videoContainerRef.current;
    const box = viewfinderBoxRef.current;

    if (!video || !container || !box) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw <= 0 || vh <= 0) return null;

    const containerRect = container.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const cw = containerRect.width;
    const ch = containerRect.height;
    if (cw <= 0 || ch <= 0) return null;

    // Tỷ lệ co giãn của video khi áp dụng CSS object-fit: cover
    const scale = Math.max(cw / vw, ch / vh);

    // Xử lý zoom kỹ thuật số 2x (nếu đang bật zoom 2x phần mềm)
    const isSoftwareZoom = !isHardwareZoomActiveRef.current && zoomLevelRef.current > 1;
    const zoomFactor = isSoftwareZoom ? 2 : 1;
    const effectiveScale = scale * zoomFactor;

    // Tọa độ tâm khung ngắm và tâm container
    const boxCenterX = (boxRect.left + boxRect.right) / 2 - containerRect.left;
    const boxCenterY = (boxRect.top + boxRect.bottom) / 2 - containerRect.top;
    const containerCenterX = cw / 2;
    const containerCenterY = ch / 2;

    const rawCropW = boxRect.width / effectiveScale;
    const rawCropH = boxRect.height / effectiveScale;

    const rawCropCenterX = vw / 2 + (boxCenterX - containerCenterX) / effectiveScale;
    const rawCropCenterY = vh / 2 + (boxCenterY - containerCenterY) / effectiveScale;

    const rawCropX = rawCropCenterX - rawCropW / 2;
    const rawCropY = rawCropCenterY - rawCropH / 2;

    // Lề đệm Quiet Zone tối thiểu 6% để đầu đọc đọc được thanh vạch đầu cuối
    // KHÔNG mở rộng ra ngoài khung ngắm
    const padW = rawCropW * 0.06;
    const padH = rawCropH * 0.06;

    const cropX = Math.max(0, Math.floor(rawCropX - padW));
    const cropY = Math.max(0, Math.floor(rawCropY - padH));
    const cropW = Math.min(vw - cropX, Math.ceil(rawCropW + padW * 2));
    const cropH = Math.min(vh - cropY, Math.ceil(rawCropH + padH * 2));

    if (cropW <= 20 || cropH <= 20) return null;

    return { cropX, cropY, cropW, cropH };
  }, []);

  // ─── VÒNG QUÉT KÉP: NATIVE BARCODE DETECTOR + ZXING C++ WASM ────────
  const startScanLoop = useCallback(async () => {
    scanLoopActiveRef.current = true;
    isDecodingRef.current = false;
    isHandlingDetectionRef.current = false;

    // 1. Khởi tạo WASM module
    const wasmResult = await getOrPreloadWasm();
    const { readBarcodesFromImageData, initDurationMs } = wasmResult;
    metricsRef.current.wasmInitMs = initDurationMs;

    // 2. Tạo Canvas tái sử dụng
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    scanStartTimestampRef.current = performance.now();
    lastFpsTimeRef.current = performance.now();
    framesInSecondRef.current = 0;
    lastTelemetrySyncRef.current = 0;

    let totalFrames = 0;
    let lastFrameTime = 0;
    // Pacing tối ưu 80ms (~12.5 FPS): Đủ nhanh để nhận mã trong 80ms nhưng giảm 75% nhiệt và pin
    const FRAME_PACING_MS = 80;

    const processFrame = async () => {
      // Luôn bảo đảm vòng lặp RAF sống chừng nào modal còn mở
      if (!scanLoopActiveRef.current) return;

      const scheduleNextFrame = () => {
        if (scanLoopActiveRef.current) {
          animationFrameRef.current = requestAnimationFrame(processFrame);
        }
      };

      // Nếu đang trong cooldown giữa 2 lần quét: tiếp tục duy trì nhịp RAF mà không decode
      if (isHandlingDetectionRef.current || isDecodingRef.current) {
        scheduleNextFrame();
        return;
      }

      const video = videoRef.current;
      const now = performance.now();

      if (
        !video ||
        video.readyState < 2 ||
        video.paused ||
        now - lastFrameTime < FRAME_PACING_MS
      ) {
        scheduleNextFrame();
        return;
      }

      lastFrameTime = now;
      isDecodingRef.current = true;
      totalFrames++;
      framesInSecondRef.current++;

      if (now - lastFpsTimeRef.current >= 1000) {
        metricsRef.current.fps = framesInSecondRef.current;
        metricsRef.current.totalFramesScanned = totalFrames;
        framesInSecondRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        if (vw > 0 && vh > 0) {
          metricsRef.current.actualResolution = `${vw}x${vh}`;

          // Tính toán ROI chuẩn xác tuyệt đối theo khung ngắm trên màn hình
          const roi = calculateExactRoi();
          if (!roi) {
            scheduleNextFrame();
            return;
          }

          // Cắt ĐÚNG vùng trong khung ngắm vào canvas
          // Giới hạn max width 720px: Giữ nguyên độ nét 1:1 cho tem vạch siêu nhỏ mà tốn cực ít RAM & GPU
          const tCropStart = performance.now();
          const targetW = Math.min(roi.cropW, 720);
          const targetH = Math.round((targetW / roi.cropW) * roi.cropH);
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }
          ctx.drawImage(video, roi.cropX, roi.cropY, roi.cropW, roi.cropH, 0, 0, targetW, targetH);
          const cropDuration = Math.round((performance.now() - tCropStart) * 10) / 10;
          metricsRef.current.cropTimeMs = cropDuration;

          // ── BƯỚC 1: HARDWARE NATIVE BARCODE DETECTOR (NẾU HỖ TRỢ TRÊN THIẾT BỊ) ──
          // TUYỆT ĐỐI chỉ quét trên canvas đã được crop theo khung ngắm
          // Không bao giờ quét full video để tránh nhận diện mã vạch bên ngoài
          if (nativeBarcodeDetector) {
            try {
              const tNativeStart = performance.now();
              const detections = await nativeBarcodeDetector.detect(canvas);

              if (detections && detections.length > 0 && detections[0]?.rawValue) {
                const detectDuration = Math.round((performance.now() - tNativeStart) * 10) / 10;
                metricsRef.current.decodeTimeMs = detectDuration;
                metricsRef.current.activeGear = 'fast';

                const exactPhoto = canvas.toDataURL('image/jpeg', 0.85);
                onCodeFound(detections[0].rawValue, detections[0].format || 'BARCODE', exactPhoto);
                return;
              }
            } catch {
              // Tiếp tục fallback sang WASM bên dưới
            }
          }

          // ── BƯỚC 2: ZXING C++ WASM ENGINE (KHÓA CHẶT TRONG KHUNG NGẮM) ──
          if (readBarcodesFromImageData) {
            const imageData = ctx.getImageData(0, 0, targetW, targetH);

            const elapsedSinceStart = performance.now() - scanStartTimestampRef.current;
            // Chiến thuật phân tầng thông minh (Tiered):
            // - Giai đoạn 1 (nhanh / mát máy): Dùng tryHarder: false, GlobalHistogram. Mã rõ nét đọc tức thì trong 2-5ms mà không tốn pin.
            // - Giai đoạn 2 (sâu / mã khó): Chỉ kích hoạt khi quét trên 1.2s hoặc mỗi 4 frame một lần.
            const isDeepAttempt = elapsedSinceStart > 1200 || (totalFrames > 6 && totalFrames % 4 === 0);
            metricsRef.current.activeGear = isDeepAttempt ? 'deep' : 'fast';

            const targetFormats = formatModeRef.current === 'serial' ? HARDWARE_SERIAL_FORMATS : ALL_COMMON_FORMATS;

            const tDecodeStart = performance.now();
            const results = await readBarcodesFromImageData(imageData, {
              formats: targetFormats,
              tryHarder: isDeepAttempt,
              tryRotate: isDeepAttempt,
              tryInvert: isDeepAttempt,
              tryDownscale: true,
              binarizer: isDeepAttempt ? 'LocalAverage' : 'GlobalHistogram',
              maxNumberOfSymbols: 1,
            });

            const decodeDuration = Math.round((performance.now() - tDecodeStart) * 10) / 10;
            metricsRef.current.decodeTimeMs = decodeDuration;

            if (now - lastTelemetrySyncRef.current >= 400) {
              lastTelemetrySyncRef.current = now;
              setTelemetry({ ...metricsRef.current });
            }

            if (results && results.length > 0 && results[0]?.text) {
              const exactPhoto = canvas.toDataURL('image/jpeg', 0.85);
              onCodeFound(results[0].text, results[0].format, exactPhoto);
              return;
            }
          }
        }
      } catch {
        // Bỏ qua lỗi frame đơn lẻ
      } finally {
        isDecodingRef.current = false;
        scheduleNextFrame();
      }
    };

    animationFrameRef.current = requestAnimationFrame(processFrame);
  }, [calculateExactRoi, onCodeFound]);

  // ─── KHỞI ĐỘNG CAMERA & ĐO THỜI GIAN MỞ CAMERA ĐỘC LẬP ──────────────────
  const startCamera = useCallback(
    async (specificDeviceId?: string) => {
      stopCamera();

      setCameraError(null);
      setIsLoadingCamera(true);
      setCameraActive(false);
      isHandlingDetectionRef.current = false;

      const tCameraStart = performance.now();

      // Kiểm tra hỗ trợ MediaDevices
      if (!navigator?.mediaDevices?.getUserMedia) {
        setCameraError('Trình duyệt không hỗ trợ mở camera trực tiếp. Hãy bấm "📷 Chụp ảnh bằng máy" bên dưới.');
        setIsLoadingCamera(false);
        return;
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: specificDeviceId
            ? {
                deviceId: { exact: specificDeviceId },
                width: { ideal: 1280, max: 1920, min: 720 },
                height: { ideal: 720, max: 1080, min: 480 },
              }
            : {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280, max: 1920, min: 720 },
                height: { ideal: 720, max: 1080, min: 480 },
              },
          audio: false,
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
          });
        }

        streamRef.current = stream;

        // Lấy danh sách camera thực tế
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setAvailableDevices(devices.filter((d) => d.kind === 'videoinput'));
        } catch {}

        // Kiểm tra capabilities THỰC TẾ của camera (Torch, Zoom, Focus)
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          metricsRef.current.cameraLabel = videoTrack.label || 'Camera sau';
          try {
            const capabilities = videoTrack.getCapabilities?.() as any;
            if (capabilities) {
              setHasTorch(Boolean(capabilities.torch));

              if (capabilities.zoom) {
                setHasZoom(true);
                setZoomMinMax({
                  min: capabilities.zoom.min || 1,
                  max: capabilities.zoom.max || 5,
                  step: capabilities.zoom.step || 0.1,
                });
                zoomLevelRef.current = 1;
                isHardwareZoomActiveRef.current = false;
                setIsHardwareZoomActive(false);
                setZoomLevel(1);
              } else {
                setHasZoom(false);
                zoomLevelRef.current = 1;
                isHardwareZoomActiveRef.current = false;
                setIsHardwareZoomActive(false);
                setZoomLevel(1);
              }

              if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
                await (videoTrack as any).applyConstraints({
                  advanced: [{ focusMode: 'continuous' }],
                });
              }
            }
          } catch {}
        }

        const videoEl = videoRef.current;
        if (!videoEl) {
          setIsLoadingCamera(false);
          return;
        }

        videoEl.muted = true;
        videoEl.defaultMuted = true;
        videoEl.playsInline = true;
        videoEl.setAttribute('playsinline', 'true');
        videoEl.setAttribute('webkit-playsinline', 'true');
        videoEl.srcObject = stream;

        await videoEl.play();

        // Ghi nhận thời gian mở camera độc lập
        metricsRef.current.cameraOpenMs = Math.round(performance.now() - tCameraStart);
        setTelemetry({ ...metricsRef.current });

        setIsLoadingCamera(false);
        setCameraActive(true);

        // Bắt đầu vòng quét WASM
        startScanLoop();
      } catch (err: any) {
        console.error('Lỗi getUserMedia:', err);
        setIsLoadingCamera(false);
        setCameraActive(false);

        const errMsg = String(err?.name || err?.message || err);
        if (/notallowed/i.test(errMsg) || /permission/i.test(errMsg)) {
          setCameraError('Quyền Camera bị từ chối. Hãy cho phép Camera trong Cài đặt Safari hoặc bấm "📷 Chụp ảnh bằng máy".');
        } else {
          setCameraError('Không thể mở camera. Vui lòng bấm "📷 Chụp ảnh bằng máy" bên dưới hoặc nhập thủ công.');
        }
      }
    },
    [stopCamera, startScanLoop]
  );

  // ─── Bật / Tắt Đèn pin (Torch) ───────────────────────────────────────────
  const handleToggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !hasTorch) return;
    try {
      const nextState = !isTorchOn;
      await track.applyConstraints({
        advanced: [{ torch: nextState } as any],
      });
      setIsTorchOn(nextState);
    } catch (e) {
      console.warn('Lỗi bật đèn pin:', e);
    }
  };

  // ─── Phóng to 1x / 2x (Hỗ trợ cả Hardware Zoom & Software High-Res Digital Zoom) ───
  const handleSetZoom = async (targetLevel: number) => {
    const nextZoom = targetLevel === 2 ? 2 : 1;
    zoomLevelRef.current = nextZoom;
    setZoomLevel(nextZoom);

    const track = streamRef.current?.getVideoTracks()[0];
    if (track && hasZoom) {
      try {
        const hardwareZoomVal = nextZoom === 2 ? Math.min(2, zoomMinMax.max) : (zoomMinMax.min || 1);
        await (track as any).applyConstraints({
          advanced: [{ zoom: hardwareZoomVal }],
        });
        const hwActive = nextZoom > 1;
        isHardwareZoomActiveRef.current = hwActive;
        setIsHardwareZoomActive(hwActive);
        return;
      } catch (e) {
        console.warn('Lỗi đổi zoom phần cứng, tự động fallback sang zoom kỹ thuật số:', e);
        isHardwareZoomActiveRef.current = false;
        setIsHardwareZoomActive(false);
      }
    } else {
      isHardwareZoomActiveRef.current = false;
      setIsHardwareZoomActive(false);
    }
  };

  const handleToggleZoom = () => {
    handleSetZoom(zoomLevelRef.current === 1 ? 2 : 1);
  };

  // ─── Đổi camera ──────────────────────────────────────────────────────────
  const handleCycleCamera = () => {
    if (availableDevices.length > 1) {
      const nextIndex = (currentDeviceIndex + 1) % availableDevices.length;
      setCurrentDeviceIndex(nextIndex);
      startCamera(availableDevices[nextIndex].deviceId);
    } else {
      startCamera();
    }
  };

  // ─── Chụp ảnh bằng máy gốc (Fallback độ nét cao) ─────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingCamera(true);
    setCameraError(null);
    stopCamera();

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const photoDataUrl = evt.target?.result as string;

        try {
          const { readBarcodes } = await getOrPreloadWasm();

          const results = await readBarcodes(file, {
            formats: ALL_COMMON_FORMATS,
            tryHarder: true,
            tryRotate: true,
            tryInvert: true,
            tryDownscale: true,
          });

          setIsLoadingCamera(false);
          if (results && results.length > 0 && results[0]?.text) {
            onCodeFound(results[0].text, results[0].format, photoDataUrl);
          } else {
            setCameraError('Không tìm thấy mã vạch trong ảnh chụp. Hãy chụp lại gần hơn và rõ nét các vạch.');
          }
        } catch (scanErr) {
          console.warn('Lỗi quét file:', scanErr);
          setIsLoadingCamera(false);
          setCameraError('Không nhận diện được mã vạch. Hãy chụp lại ở cự ly gần và đủ sáng.');
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setIsLoadingCamera(false);
      setCameraError('Không thể đọc file ảnh.');
    }
    e.target.value = '';
  };

  // ─── Vòng đời modal ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setScannedBatch([]);
      setManualCode('');
      setCameraError(null);
      setContinuousToast(null);
      isHandlingDetectionRef.current = false;

      const timer = setTimeout(() => {
        startCamera();
      }, 20);

      return () => {
        clearTimeout(timer);
        stopCamera();
      };
    } else {
      stopCamera();
    }
  }, [isOpen, startCamera, stopCamera]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualCode.trim();
    if (!trimmed) return;

    playScannerBeep();

    setScannedBatch((prev) => {
      const exists = prev.some((item) => item.code.toLowerCase() === trimmed.toLowerCase());
      if (exists) {
        setContinuousToast(`⚠️ Đã có trong danh sách: ${trimmed}`);
        setTimeout(() => setContinuousToast(null), 1200);
        return prev;
      }
      const newItem: ScannedBatchItem = {
        code: trimmed,
        format: 'MANUAL',
        timestamp: Date.now(),
      };
      const updated = [newItem, ...prev];
      setContinuousToast(`✓ Đã thêm: ${trimmed} (${updated.length} mã)`);
      setTimeout(() => setContinuousToast(null), 1200);
      return updated;
    });

    setManualCode('');
  };

  const handleConfirmBatch = () => {
    if (scannedBatch.length === 0) return;
    if (onBatchDetected) {
      onBatchDetected(scannedBatch);
    } else {
      for (const item of scannedBatch) {
        onDetected(item.code, item.photo);
      }
    }
    stopCamera();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 150 }} onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{title}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              <span
                style={{
                  fontSize: '0.68rem',
                  padding: '2px 7px',
                  borderRadius: 4,
                  fontWeight: 600,
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: '#60a5fa',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                }}
              >
                ⚙️ {ZXING_ENGINE_INFO.package} v{ZXING_ENGINE_INFO.version} (C++ WASM)
              </span>
              <button
                type="button"
                onClick={() => setShowTelemetry((s) => !s)}
                style={{
                  background: showTelemetry ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: showTelemetry ? '#4ade80' : 'var(--text-muted)',
                  borderRadius: 4,
                  fontSize: '0.68rem',
                  padding: '1px 6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                title="Bật/Tắt bảng đo lường hiệu năng decoder theo từng công đoạn"
              >
                📊 Đo lường {showTelemetry ? '▼' : '▶'}
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.5rem',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* BẢNG ĐO LƯỜNG TELEMETRY (ĐO TÁCH BIỆT TỪNG CÔNG ĐOẠN) */}
        {showTelemetry && (
          <div
            style={{
              background: '#090d16',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 10px',
              fontSize: '0.72rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '4px 8px',
              marginTop: 6,
              color: '#cbd5e1',
            }}
          >
            <div>
              📷 Mở camera: <strong style={{ color: '#93c5fd' }}>{telemetry.cameraOpenMs !== null ? `${telemetry.cameraOpenMs}ms` : '---'}</strong>
            </div>
            <div>
              ⚡ Nạp WASM: <strong style={{ color: '#93c5fd' }}>{telemetry.wasmInitMs !== null ? `${telemetry.wasmInitMs}ms` : '0ms'}</strong>
            </div>
            <div>
              ✂️ Lấy & Cắt ROI: <strong style={{ color: '#a7f3d0' }}>{telemetry.cropTimeMs}ms</strong>
            </div>
            <div>
              🧩 Decode frame: <strong style={{ color: '#a7f3d0' }}>{telemetry.decodeTimeMs}ms</strong>
            </div>
            <div>
              ⏱️ Nhận diện (First-sight): <strong style={{ color: '#fde047' }}>{telemetry.timeToDetectMs !== null ? `${telemetry.timeToDetectMs}ms` : 'Đang quét...'}</strong>
            </div>
            <div>
              🎯 Gear: <strong style={{ color: telemetry.activeGear === 'fast' ? '#4ade80' : '#f59e0b' }}>{telemetry.activeGear.toUpperCase()}</strong> ({telemetry.fps} FPS)
            </div>
            <div style={{ gridColumn: 'span 2', fontSize: '0.68rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 4 }}>
              Cảm biến: {telemetry.actualResolution} • Cam: {telemetry.cameraLabel}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          {/* Thanh chuyển chế độ lọc định dạng barcode */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Mục tiêu:</span>
            <button
              type="button"
              onClick={() => setFormatMode('serial')}
              style={{
                fontSize: '0.72rem',
                padding: '3px 8px',
                borderRadius: 4,
                border: formatMode === 'serial' ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.15)',
                background: formatMode === 'serial' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: formatMode === 'serial' ? '#93c5fd' : 'var(--text-muted)',
                fontWeight: formatMode === 'serial' ? 700 : 400,
                cursor: 'pointer',
              }}
            >
              🏷️ Serial tem máy (Code128, 39, QR)
            </button>
            <button
              type="button"
              onClick={() => setFormatMode('all')}
              style={{
                fontSize: '0.72rem',
                padding: '3px 8px',
                borderRadius: 4,
                border: formatMode === 'all' ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.15)',
                background: formatMode === 'all' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: formatMode === 'all' ? '#93c5fd' : 'var(--text-muted)',
                fontWeight: formatMode === 'all' ? 700 : 400,
                cursor: 'pointer',
              }}
            >
              🌐 Tất cả mã (+EAN/UPC)
            </button>
          </div>

          {/* Vùng chứa camera Scanner */}
          <div
            ref={videoContainerRef}
            style={{
              position: 'relative',
              width: '100%',
              height: 270,
              background: '#090d16',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Thẻ video luồng camera (Hỗ trợ chạm màn hình để lấy nét lại) */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onClick={() => {
                const track = streamRef.current?.getVideoTracks()[0];
                if (track) {
                  try {
                    const caps = (track.getCapabilities?.() as any) || {};
                    if (caps.focusMode && caps.focusMode.includes('continuous')) {
                      (track as any).applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
                    }
                  } catch {}
                }
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                cursor: 'pointer',
                transform: !isHardwareZoomActive && zoomLevel > 1 ? 'scale(2)' : 'none',
                transformOrigin: 'center center',
                transition: 'transform 0.25s ease-out',
              }}
            />

            {/* Viewfinder ngắm barcode & tia laser chuyển động */}
            {cameraActive && !isLoadingCamera && !cameraError && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 4,
                }}
              >
                {/* Khung chữ nhật rộng rãi trợ ngắm */}
                <div
                  ref={viewfinderBoxRef}
                  className="scanner-reticle-box"
                  style={{
                    position: 'relative',
                    width: '88%',
                    maxWidth: 360,
                    height: 160,
                    border: '2px solid rgba(59, 130, 246, 0.9)',
                    borderRadius: 14,
                    overflow: 'hidden',
                  }}
                >
                  {/* Tia laser đỏ quét ngang */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      height: 2,
                      background: '#ef4444',
                      boxShadow: '0 0 10px #ef4444, 0 0 4px #fff',
                      animation: 'scanLaser 1.8s ease-in-out infinite alternate',
                    }}
                  />
                  {/* 4 góc trợ ngắm */}
                  {[
                    { top: 0, left: 0, borderTop: '3px solid #60a5fa', borderLeft: '3px solid #60a5fa' },
                    { top: 0, right: 0, borderTop: '3px solid #60a5fa', borderRight: '3px solid #60a5fa' },
                    { bottom: 0, left: 0, borderBottom: '3px solid #60a5fa', borderLeft: '3px solid #60a5fa' },
                    { bottom: 0, right: 0, borderBottom: '3px solid #60a5fa', borderRight: '3px solid #60a5fa' },
                  ].map((s, i) => (
                    <div key={i} style={{ position: 'absolute', width: 16, height: 16, ...s }} />
                  ))}
                </div>

                {/* Dòng hướng dẫn người dùng động thông minh */}
                <div
                  style={{
                    marginTop: 8,
                    background:
                      scanIdleSeconds >= 6
                        ? 'rgba(180, 83, 9, 0.92)'
                        : scanIdleSeconds >= 3
                        ? 'rgba(30, 58, 138, 0.92)'
                        : 'rgba(0, 0, 0, 0.78)',
                    color: scanIdleSeconds >= 6 ? '#fef08a' : '#f8fafc',
                    fontSize: '0.72rem',
                    padding: '4px 12px',
                    borderRadius: 16,
                    border:
                      scanIdleSeconds >= 6
                        ? '1px solid rgba(245, 158, 11, 0.6)'
                        : '1px solid rgba(255, 255, 255, 0.15)',
                    transition: 'all 0.3s ease',
                    textAlign: 'center',
                    maxWidth: '92%',
                  }}
                >
                  {scanIdleSeconds < 3 && '🎯 Quét toàn màn hình • Giữ cách tem 15-25cm • Bấm nút [2x] nếu tem nhỏ'}
                  {scanIdleSeconds >= 3 && scanIdleSeconds < 6 && '💡 Thử bấm nút [2x] ở góc phải để phóng to mã vạch'}
                  {scanIdleSeconds >= 6 && '⚡ Tem bóng/lóa? Nghiêng nhẹ máy hoặc bấm [📷 Chụp ảnh bằng máy]'}
                </div>
              </div>
            )}

            {/* Nút chọn Zoom 1x / 2x nổi trên camera */}
            {cameraActive && !isLoadingCamera && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(8px)',
                  borderRadius: 24,
                  padding: '3px',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  zIndex: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}
              >
                <button
                  type="button"
                  onClick={() => handleSetZoom(1)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 20,
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    background: zoomLevel === 1 ? '#2563eb' : 'transparent',
                    color: zoomLevel === 1 ? '#ffffff' : '#94a3b8',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    letterSpacing: '0.5px',
                  }}
                  title="Góc nhìn chuẩn 1x"
                >
                  1x
                </button>
                <button
                  type="button"
                  onClick={() => handleSetZoom(2)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 20,
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    background: zoomLevel === 2 ? '#2563eb' : 'transparent',
                    color: zoomLevel === 2 ? '#ffffff' : '#94a3b8',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    letterSpacing: '0.5px',
                  }}
                  title="Phóng to 2x (Đọc tem mã vạch siêu nhỏ)"
                >
                  2x
                </button>
              </div>
            )}

            {/* Toast thông báo chế độ quét liên tục */}
            {continuousToast && (
              <div
                style={{
                  position: 'absolute',
                  top: 14,
                  background: continuousToast.startsWith('⚠️') ? 'var(--warning-bg)' : 'var(--success)',
                  color: continuousToast.startsWith('⚠️') ? '#fcd34d' : '#fff',
                  border: continuousToast.startsWith('⚠️') ? '1px solid #f59e0b' : 'none',
                  padding: '7px 16px',
                  borderRadius: 20,
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  boxShadow: '0 4px 14px rgba(0,0,0,0.6)',
                  zIndex: 20,
                  animation: 'slideDown 0.2s ease-out',
                }}
              >
                {continuousToast}
              </div>
            )}

            {/* Loading overlay */}
            {isLoadingCamera && !cameraError && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(9, 13, 22, 0.88)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  gap: 10,
                  zIndex: 10,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    border: '3px solid rgba(255,255,255,0.2)',
                    borderTopColor: 'var(--primary)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span style={{ fontSize: '0.85rem' }}>Đang khởi động camera...</span>
                <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)' }}>
                  Bấm &ldquo;Cho phép&rdquo; nếu trình duyệt hỏi quyền
                </span>
              </div>
            )}

            {/* Overlay hiển thị lỗi */}
            {cameraError && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  padding: 16,
                  textAlign: 'center',
                  color: '#fca5a5',
                  fontSize: '0.85rem',
                  background: 'rgba(15,23,42,0.95)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  zIndex: 11,
                }}
              >
                <div style={{ lineHeight: 1.5 }}>{cameraError}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem' }}
                    onClick={() => startCamera()}
                  >
                    🔄 Thử lại
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '0.8rem' }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📷 Chụp ảnh bằng máy
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Các nút điều khiển tiện ích */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                flex: 2,
                minWidth: 140,
                fontSize: '0.85rem',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <span>📷</span>
              <span>Chụp ảnh bằng máy</span>
            </button>

            {/* Nút Zoom 1x / 2x dưới thanh công cụ */}
            {cameraActive && (
              <button
                type="button"
                className={`btn ${zoomLevel > 1 ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                onClick={handleToggleZoom}
                title="Chuyển đổi phóng to 1x / 2x"
              >
                {zoomLevel > 1 ? '🔍 2x' : '🔍 1x'}
              </button>
            )}

            {/* Nút Đèn pin chỉ hiện khi capability thực tế hỗ trợ */}
            {hasTorch && (
              <button
                type="button"
                className={`btn ${isTorchOn ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                onClick={handleToggleTorch}
                title="Bật/tắt đèn flash"
              >
                {isTorchOn ? '🔦 Tắt đèn' : '⚡ Bật đèn'}
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1, minWidth: 95, fontSize: '0.85rem', padding: '8px 10px' }}
              onClick={handleCycleCamera}
              title="Đổi camera trước / sau hoặc ống kính khác"
            >
              🔄 Đổi cam {availableDevices.length > 1 ? `(${currentDeviceIndex + 1}/${availableDevices.length})` : ''}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </div>
        </div>

        {/* DANH SÁCH MÃ ĐÃ QUÉT TRONG PHIÊN (BẰNG CHỨNG + ẢNH THẬT ĐÃ DECODE) */}
        {scannedBatch.length > 0 ? (
          <div
            style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.35)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginTop: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#93c5fd' }}>
                📦 Đã quét: <strong>{scannedBatch.length}</strong> thiết bị
              </span>
              <button
                type="button"
                onClick={() => setScannedBatch([])}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Xóa tất cả
              </button>
            </div>

            {/* Danh sách cuộn ngang có ảnh thumbnail bằng chứng */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                overflowX: 'auto',
                paddingBottom: 4,
                scrollbarWidth: 'thin',
              }}
            >
              {scannedBatch.map((item, idx) => (
                <div
                  key={`${item.code}-${idx}`}
                  className="scanned-batch-chip"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px',
                    flexShrink: 0,
                  }}
                >
                  {item.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.photo}
                      alt="Decoded Evidence"
                      style={{
                        width: 44,
                        height: 38,
                        objectFit: 'cover',
                        borderRadius: 4,
                        border: '1px solid var(--primary)',
                      }}
                      title="Ảnh chụp chính xác từ canvas lúc decoder nhận diện thành công"
                    />
                  ) : (
                    <div
                      style={{
                        width: 44,
                        height: 38,
                        background: 'rgba(255,255,255,0.06)',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1rem',
                      }}
                    >
                      🏷️
                    </div>
                  )}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#fff' }}>
                      {item.code}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      {item.format || 'BARCODE'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScannedBatch((prev) => prev.filter((_, i) => i !== idx))}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--danger)',
                      fontSize: '1.2rem',
                      cursor: 'pointer',
                      padding: '0 2px',
                      lineHeight: 1,
                      marginLeft: 4,
                    }}
                    title="Xóa mã này khỏi danh sách"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>

            {/* Nút to xác nhận hoàn tất danh sách */}
            <button
              type="button"
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '11px',
                fontSize: '0.92rem',
                fontWeight: 700,
                marginTop: 2,
              }}
              onClick={handleConfirmBatch}
            >
              ✓ Xác nhận danh sách ({scannedBatch.length} mã)
            </button>
          </div>
        ) : (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 'var(--radius-sm)',
              border: '1px dashed var(--border-color)',
              fontSize: '0.78rem',
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginTop: 10,
            }}
          >
            💡 Đưa camera vào mã vạch để quét liên tục. Mỗi mã sẽ tự động chụp ảnh & thêm vào danh sách để bạn xác nhận 1 lần.
          </div>
        )}

        {/* Nhập mã thủ công */}
        {allowManual && (
          <form
            onSubmit={handleManualSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}
          >
            <div className="form-label" style={{ fontSize: '0.78rem' }}>Hoặc nhập SN / Mã quản lý thủ công:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="input"
                placeholder="VD: PF-3A9804 hoặc CN-DELL..."
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
              />
              <button type="submit" className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }}>
                + Thêm vào DS
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
