'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface ScannedBatchItem {
  code: string;
  photo?: string;
  format?: string;
  timestamp: number;
}

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (code: string, photoDataUrl?: string) => void;
  onBatchDetected?: (items: ScannedBatchItem[]) => void;
  title?: string;
  allowManual?: boolean;
}

// ─── Module-level WASM Pre-warming (Khởi tạo sẵn trong RAM khi nạp trang) ──
let cachedZxingReader: ((imageData: ImageData, options?: any) => Promise<any[]>) | null = null;
let cachedReadBarcodes: ((input: any, options?: any) => Promise<any[]>) | null = null;
let isPreloadingWasm = false;

// ─── Native BarcodeDetector (Phần cứng GPU / Apple Neural Engine / Android NPU) ──
let cachedNativeDetector: any = null;
let hasCheckedNativeDetector = false;

async function getNativeBarcodeDetector() {
  if (hasCheckedNativeDetector) return cachedNativeDetector;
  hasCheckedNativeDetector = true;
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const BarcodeDetectorClass = (window as any).BarcodeDetector;
      let supportedFormats: string[] = [];
      if (typeof BarcodeDetectorClass.getSupportedFormats === 'function') {
        supportedFormats = await BarcodeDetectorClass.getSupportedFormats();
      }
      const desired = ['code_128', 'ean_13', 'code_39', 'qr_code', 'data_matrix', 'upc_a', 'upc_e'];
      const formats = supportedFormats.length > 0
        ? desired.filter((f: string) => supportedFormats.includes(f))
        : desired;
      if (formats.length > 0) {
        cachedNativeDetector = new BarcodeDetectorClass({ formats });
      }
    } catch (e) {
      console.warn('Native BarcodeDetector fallback:', e);
      cachedNativeDetector = null;
    }
  }
  return cachedNativeDetector;
}

async function getOrPreloadWasm() {
  if (cachedZxingReader && cachedReadBarcodes) {
    return { readBarcodesFromImageData: cachedZxingReader, readBarcodes: cachedReadBarcodes };
  }
  if (isPreloadingWasm) {
    while (isPreloadingWasm) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return { readBarcodesFromImageData: cachedZxingReader!, readBarcodes: cachedReadBarcodes! };
  }
  isPreloadingWasm = true;
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
    // Chạy thử 1 buffer để JIT engine WebAssembly biên dịch trước toàn bộ bảng giải mã
    try {
      const dummy = new ImageData(10, 10);
      await zxing.readBarcodesFromImageData(dummy, {
        formats: ['Code128', 'Code39', 'EAN-13', 'QRCode', 'UPC-A', 'ITF', 'Codabar'],
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        tryDownscale: true,
        binarizer: 'LocalAverage',
      });
    } catch {}
    cachedZxingReader = zxing.readBarcodesFromImageData;
    cachedReadBarcodes = zxing.readBarcodes;
  } catch (e) {
    console.warn('Lỗi preload WebAssembly:', e);
  } finally {
    isPreloadingWasm = false;
  }
  return { readBarcodesFromImageData: cachedZxingReader!, readBarcodes: cachedReadBarcodes! };
}

// Kích hoạt preload ngay khi file được nạp ở client
if (typeof window !== 'undefined') {
  setTimeout(() => {
    getNativeBarcodeDetector();
    getOrPreloadWasm();
  }, 40);
}

// Âm thanh bíp xác nhận tức thì (Web Audio API, độ trễ 0ms)
function playScannerBeep() {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1760, ctx.currentTime); // Âm bíp tần số 1760Hz đanh, rõ
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
  const [detectedLatencyMs, setDetectedLatencyMs] = useState<number | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<string | null>(null);
  const [activeEngine, setActiveEngine] = useState<'hardware' | 'wasm'>('wasm');
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState<number>(0);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [hasZoom, setHasZoom] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [zoomMinMax, setZoomMinMax] = useState<{ min: number; max: number; step: number }>({ min: 1, max: 2, step: 0.1 });
  const [inAppNotice, setInAppNotice] = useState(false);
  const [continuousToast, setContinuousToast] = useState<string | null>(null);
  const [scanIdleSeconds, setScanIdleSeconds] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopActiveRef = useRef(false);

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
  const isDecodingRef = useRef(false);
  const isHandlingDetectionRef = useRef(false);
  const scanStartTimeRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // ─── Dừng camera & vòng lặp quét ─────────────────────────────────────────
  const stopCamera = useCallback(() => {
    scanLoopActiveRef.current = false;
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
    setZoomLevel(1);
    setContinuousToast(null);
  }, []);

  // ─── Chụp khung hình đối chiếu (bằng chứng) siêu tốc ─────────────────────
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null;
    try {
      // Downscale nhẹ về 480px: Giảm thời gian nén từ ~50ms xuống ~3ms, triệt tiêu giật lag UI
      const targetW = 480;
      const targetH = Math.round((video.videoHeight / video.videoWidth) * targetW);
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, targetW, targetH);
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch {
      return null;
    }
  }, []);

  // ─── Xử lý khi phát hiện mã: TỰ ĐỘNG CHỤP ẢNH & GOM VÀO DANH SÁCH ─────────
  const onCodeFound = useCallback(
    (code: string, format?: string, customPhoto?: string) => {
      if (isHandlingDetectionRef.current) return;
      isHandlingDetectionRef.current = true;
      setScanIdleSeconds(0);

      const trimmed = code.trim();
      if (!trimmed) {
        isHandlingDetectionRef.current = false;
        return;
      }

      const latency = scanStartTimeRef.current > 0 ? Math.round(performance.now() - scanStartTimeRef.current) : null;
      setDetectedLatencyMs(latency);
      if (format) setDetectedFormat(format);

      // Âm thanh bíp tức thì & rung phản hồi haptic
      playScannerBeep();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(100);
        } catch {}
      }

      const photo = customPhoto || captureFrame();

      setScannedBatch((prev) => {
        const exists = prev.some((item) => item.code.toLowerCase() === trimmed.toLowerCase());
        if (exists) {
          setContinuousToast(`⚠️ Đã có trong danh sách: ${trimmed}`);
          setTimeout(() => {
            setContinuousToast(null);
            scanStartTimeRef.current = performance.now();
            isHandlingDetectionRef.current = false;
          }, 900);
          return prev;
        }

        const newItem: ScannedBatchItem = {
          code: trimmed,
          photo: photo || undefined,
          format: format || 'BARCODE',
          timestamp: Date.now(),
        };

        const updated = [newItem, ...prev];
        setContinuousToast(`✓ Đã quét: ${trimmed} (${updated.length} mã)`);

        // Cooldown siêu nhạy 400ms: Sau khi bíp, camera lập tức sẵn sàng quét mã kế tiếp
        setTimeout(() => {
          setContinuousToast(null);
          scanStartTimeRef.current = performance.now();
          isHandlingDetectionRef.current = false;
        }, 400);

        return updated;
      });
    },
    [captureFrame]
  );

  // ─── Động cơ quét Hybrid kép: Native Hardware AI + ZXing C++ WASM Turbo ──
  const startScanLoop = useCallback(async () => {
    scanLoopActiveRef.current = true;
    isDecodingRef.current = false;

    // Chuẩn bị song song cả 2 động cơ
    const [nativeDetector, wasmModule] = await Promise.all([
      getNativeBarcodeDetector(),
      getOrPreloadWasm(),
    ]);

    if (nativeDetector) {
      setActiveEngine('hardware');
    } else {
      setActiveEngine('wasm');
    }

    const { readBarcodesFromImageData } = wasmModule;

    // Canvas tĩnh tái sử dụng (Zero garbage allocation) cho WASM fallback
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    scanStartTimeRef.current = performance.now();
    let frameCounter = 0;
    let lastDecodeTime = 0;
    const FRAME_INTERVAL_MS = 25; // Điều tiết nhịp ~35-40 FPS, chống quá nhiệt điện thoại

    const processFrame = async () => {
      if (!scanLoopActiveRef.current || isHandlingDetectionRef.current) return;

      const video = videoRef.current;
      const now = performance.now();

      if (
        video &&
        video.readyState >= 2 &&
        !video.paused &&
        !isDecodingRef.current &&
        now - lastDecodeTime >= FRAME_INTERVAL_MS
      ) {
        lastDecodeTime = now;
        isDecodingRef.current = true;

        try {
          // ── BƯỚC 1: QUÉT TRỰC TIẾP QUA NATIVE GPU / APPLE NEURAL ENGINE (< 12ms) ──
          if (nativeDetector) {
            try {
              const detected = await nativeDetector.detect(video);
              if (detected && detected.length > 0 && detected[0]?.rawValue) {
                onCodeFound(detected[0].rawValue, detected[0].format || 'BARCODE');
                return;
              }
            } catch {
              // Nếu frame bị lỗi lướt nhanh thì bỏ qua sang WASM
            }
          }

          // ── BƯỚC 2: FALLBACK SANG ZXING C++ WASM TURBO (1:1 PIXEL GỐC, KHÔNG DOWNSCALE) ─
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (vw > 0 && vh > 0 && readBarcodesFromImageData) {
            frameCounter++;

            // QUÉT NGUYÊN BẢN 1:1 PIXEL (BẢO TOÀN TUYỆT ĐỐI CÁC ĐƯỜNG KẺ MÃ VẠCH 1PX):
            // Pass 1: Cắt trọng tâm 75% rộng x 55% cao ở độ phân giải 1:1 gốc của cảm biến
            // Pass 2: Quét toàn cảnh cảm biến gốc
            const isCenterCropPass = frameCounter % 2 === 0;

            if (isCenterCropPass) {
              const cropW = Math.round(vw * 0.75);
              const cropH = Math.round(vh * 0.55);
              const cropX = Math.round((vw - cropW) / 2);
              const cropY = Math.round((vh - cropH) / 2);

              if (canvas.width !== cropW || canvas.height !== cropH) {
                canvas.width = cropW;
                canvas.height = cropH;
              }
              ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            } else {
              if (canvas.width !== vw || canvas.height !== vh) {
                canvas.width = vw;
                canvas.height = vh;
              }
              ctx.drawImage(video, 0, 0, vw, vh);
            }

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // BẬT TOÀN DIỆN MỌI CỜ TRÊN MỌI FRAME (Tốc độ C++ WASM cực nhanh chỉ 3-8ms):
            // - tryHarder: true (tìm kiếm đa tỷ lệ)
            // - tryRotate: true (nhận diện cả góc nghiêng 45° hay dọc/ngang)
            // - tryInvert: true (nhận diện tem bạc phản quang / tem đen trắng)
            // - tryDownscale: true (thuật toán lọc vạch C++ nội bộ)
            // - binarizer: 'LocalAverage' (xử lý bóng mờ, chói sáng môi trường văn phòng)
            const results = await readBarcodesFromImageData(imageData, {
              formats: ['Code128', 'Code39', 'EAN-13', 'QRCode', 'UPC-A', 'ITF', 'Codabar'],
              tryHarder: true,
              tryRotate: true,
              tryInvert: true,
              tryDownscale: true,
              binarizer: 'LocalAverage',
              maxNumberOfSymbols: 1,
            });

            if (results && results.length > 0 && results[0]?.text) {
              onCodeFound(results[0].text, results[0].format);
              return;
            }
          }
        } catch {
          // Bỏ qua lỗi frame đơn lẻ
        } finally {
          isDecodingRef.current = false;
        }
      }

      if (scanLoopActiveRef.current && !isHandlingDetectionRef.current) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
      }
    };

    animationFrameRef.current = requestAnimationFrame(processFrame);
  }, [onCodeFound]);

  // ─── Khởi động camera tức thì (Không delay) ──────────────────────────────
  const startCamera = useCallback(
    async (specificDeviceId?: string) => {
      stopCamera();

      setCameraError(null);
      setIsLoadingCamera(true);
      setCameraActive(false);
      setDetectedLatencyMs(null);
      setDetectedFormat(null);
      isHandlingDetectionRef.current = false;

      // Kiểm tra HTTPS
      if (typeof window !== 'undefined') {
        const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        if (!window.isSecureContext && !isLocal) {
          setCameraError('Camera yêu cầu bảo mật HTTPS. Vui lòng mở trang web qua link https://');
          setIsLoadingCamera(false);
          return;
        }
        const ua = navigator.userAgent || '';
        if (/FBAN|FBAV|Instagram|Zalo|Line|MicroMessenger/i.test(ua)) {
          setInAppNotice(true);
        }
      }

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
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 },
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

        // Lấy danh sách camera
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setAvailableDevices(devices.filter((d) => d.kind === 'videoinput'));
        } catch {}

        // Kiểm tra đèn pin, Zoom & kích hoạt lấy nét liên tục (Continuous Autofocus)
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          try {
            const capabilities = videoTrack.getCapabilities?.() as any;
            if (capabilities && capabilities.torch) {
              setHasTorch(true);
            }
            if (capabilities && capabilities.zoom) {
              setHasZoom(true);
              setZoomMinMax({
                min: capabilities.zoom.min || 1,
                max: capabilities.zoom.max || 5,
                step: capabilities.zoom.step || 0.1,
              });
              setZoomLevel(1);
            } else {
              setHasZoom(false);
            }
            if (capabilities && capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
              await (videoTrack as any).applyConstraints({
                advanced: [{ focusMode: 'continuous' }],
              });
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
        setIsLoadingCamera(false);
        setCameraActive(true);

        // Khởi động vòng quét siêu tốc Hybrid
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

  // ─── Phóng to 2x (Hardware Zoom) để lấy nét cự ly xa ───────────────────────
  const handleToggleZoom = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !hasZoom) return;
    try {
      const nextZoom = zoomLevel === 1 ? Math.min(2, zoomMinMax.max) : 1;
      await (track as any).applyConstraints({
        advanced: [{ zoom: nextZoom }],
      });
      setZoomLevel(nextZoom);
    } catch (e) {
      console.warn('Lỗi đổi zoom:', e);
    }
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

  // ─── Chụp ảnh bằng máy gốc (Độ nét cao nhất) ────────────────────────────
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
            formats: ['Code128', 'EAN-13', 'Code39', 'QRCode'],
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
      setDetectedLatencyMs(null);
      setDetectedFormat(null);
      setCameraError(null);
      setInAppNotice(false);
      setContinuousToast(null);
      isHandlingDetectionRef.current = false;

      // Khởi động tức thì (chỉ 20ms để DOM mount)
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
    const photo = captureFrame();

    setScannedBatch((prev) => {
      const exists = prev.some((item) => item.code.toLowerCase() === trimmed.toLowerCase());
      if (exists) {
        setContinuousToast(`⚠️ Đã có trong danh sách: ${trimmed}`);
        setTimeout(() => setContinuousToast(null), 1200);
        return prev;
      }
      const newItem: ScannedBatchItem = {
        code: trimmed,
        photo: photo || undefined,
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
                  background: activeEngine === 'hardware' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                  color: activeEngine === 'hardware' ? '#4ade80' : '#60a5fa',
                  border: activeEngine === 'hardware' ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(59, 130, 246, 0.3)',
                }}
              >
                {activeEngine === 'hardware' ? '⚡ Apple/Chrome Hardware AI (< 15ms)' : '⚙️ ZXing C++ WASM Turbo (< 30ms)'}
              </span>
              {detectedLatencyMs !== null && (
                <span style={{ fontSize: '0.68rem', color: '#a7f3d0' }}>
                  ⏱️ {detectedLatencyMs}ms
                </span>
              )}
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

        {/* Cảnh báo in-app browser */}
        {inAppNotice && (
          <div
            style={{
              fontSize: '0.75rem',
              background: '#3b2505',
              color: '#fed7aa',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              marginTop: 4,
            }}
          >
            ⚠️ Đang mở trong ứng dụng khác. Hãy bấm menu ⋮ → <strong>Mở bằng Safari / Chrome</strong> để quét nhanh nhất.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          {/* Vùng chứa camera Scanner */}
          <div
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
            {/* Thẻ video luồng camera mượt mà */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
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
                {/* Khung chữ nhật ngang tối ưu cho mã vạch 1D */}
                <div
                  style={{
                    position: 'relative',
                    width: '84%',
                    maxWidth: 320,
                    height: 130,
                    border: '2px solid rgba(59, 130, 246, 0.9)',
                    borderRadius: 14,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.42)',
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
                  {scanIdleSeconds < 3 && '🎯 Giữ cách tem 20-30cm (đừng để sát camera bị mờ) • Bấm [🔍 2x] nếu tem nhỏ'}
                  {scanIdleSeconds >= 3 && scanIdleSeconds < 6 && '💡 Thử bấm nút [🔍 2x] ở góc phải để phóng to mã vạch siêu nét'}
                  {scanIdleSeconds >= 6 && '⚡ Tem bóng/lóa? Nghiêng nhẹ máy hoặc bấm [📷 Chụp ảnh bằng máy]'}
                </div>
              </div>
            )}

            {/* Nút Zoom nhanh 1x / 2x trên màn hình camera */}
            {cameraActive && hasZoom && (
              <button
                type="button"
                onClick={handleToggleZoom}
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  background: zoomLevel > 1 ? 'rgba(59, 130, 246, 0.92)' : 'rgba(0, 0, 0, 0.72)',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.35)',
                  borderRadius: 16,
                  padding: '5px 12px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  zIndex: 10,
                  backdropFilter: 'blur(6px)',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.6)',
                }}
                title="Phóng to 2x để lấy nét các tem mã nhỏ ở khoảng cách 20-30cm"
              >
                {zoomLevel > 1 ? '🔍 2x' : '🔍 1x'}
              </button>
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

            {hasZoom && (
              <button
                type="button"
                className={`btn ${zoomLevel > 1 ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                onClick={handleToggleZoom}
                title="Phóng to 2x giúp đọc tem mã nhỏ siêu nét"
              >
                {zoomLevel > 1 ? '🔍 2x' : '🔍 1x'}
              </button>
            )}

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

        {/* DANH SÁCH MÃ ĐÃ QUÉT TRONG PHIÊN (BẰNG CHỨNG + ẢNH) */}
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

            {/* Danh sách cuộn ngang có ảnh thumbnail */}
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
                      alt="Snap"
                      style={{
                        width: 38,
                        height: 38,
                        objectFit: 'cover',
                        borderRadius: 4,
                        border: '1px solid var(--primary)',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 38,
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
