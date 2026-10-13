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
    // Chạy thử 1 buffer rỗng nhỏ để JIT engine WebAssembly biên dịch trước
    try {
      const dummy = new ImageData(1, 1);
      await zxing.readBarcodesFromImageData(dummy);
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
    getOrPreloadWasm();
  }, 50);
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
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState<number>(0);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
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
    setContinuousToast(null);
  }, []);

  // ─── Chụp khung hình đối chiếu (bằng chứng) ──────────────────────────────
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
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
          }, 1100);
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

        // Camera tiếp tục quét liên tục sau 850ms cooldown
        setTimeout(() => {
          setContinuousToast(null);
          scanStartTimeRef.current = performance.now();
          isHandlingDetectionRef.current = false;
        }, 850);

        return updated;
      });
    },
    [captureFrame]
  );

  // ─── Vòng quét WebAssembly siêu tốc (Tần số cao ~45 FPS + Dual Pass) ─────
  const startWasmScanLoop = useCallback(async () => {
    scanLoopActiveRef.current = true;
    isDecodingRef.current = false;

    // Lấy module WASM đã được pre-warm sẵn trong RAM
    const { readBarcodesFromImageData } = await getOrPreloadWasm();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    scanStartTimeRef.current = performance.now();
    let frameCounter = 0;

    const processFrame = async () => {
      if (!scanLoopActiveRef.current || isHandlingDetectionRef.current) return;

      const video = videoRef.current;
      if (
        video &&
        video.readyState >= 2 &&
        !video.paused &&
        !isDecodingRef.current &&
        readBarcodesFromImageData
      ) {
        isDecodingRef.current = true;
        try {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (vw > 0 && vh > 0) {
            frameCounter++;

            // DUAL-PASS SCANNING:
            // Pass 1 (Chẵn): Cắt trọng tâm (Center crop 70% width, 50% height).
            // Lợi ích: Vạch barcode to gấp đôi, CPU chỉ xử lý ~140.000 pixel trong 3-4ms!
            // Pass 2 (Lẻ): Quét toàn cảnh (Full frame 640px) để không bỏ sót mã ở viền màn hình.
            const isCenterCropPass = frameCounter % 2 === 0;

            let targetW: number;
            let targetH: number;

            if (isCenterCropPass) {
              const cropX = Math.round(vw * 0.12);
              const cropY = Math.round(vh * 0.22);
              const cropW = Math.round(vw * 0.76);
              const cropH = Math.round(vh * 0.56);

              targetW = 560;
              targetH = Math.round((cropH / cropW) * targetW);

              if (canvas.width !== targetW || canvas.height !== targetH) {
                canvas.width = targetW;
                canvas.height = targetH;
              }
              ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
            } else {
              targetW = 640;
              targetH = Math.round((vh / vw) * targetW);

              if (canvas.width !== targetW || canvas.height !== targetH) {
                canvas.width = targetW;
                canvas.height = targetH;
              }
              ctx.drawImage(video, 0, 0, targetW, targetH);
            }

            const imageData = ctx.getImageData(0, 0, targetW, targetH);

            // Chiến thuật giải mã siêu tốc đa nhịp (Interleaved Multi-gear Engine):
            // - Nhịp nhanh (Gear 1, 3/4 frame): GlobalHistogram, tryHarder: false => Chỉ 1-2ms, nhận diện tức thì trong 100-300ms
            // - Nhịp sâu (Gear 2, mỗi 4 frame): LocalAverage, tryHarder: true, xoay, khử lóa => ~15ms, cứu tem mờ/nghiêng
            const isDeepScan = frameCounter % 4 === 0;
            const results = await readBarcodesFromImageData(imageData, {
              formats: ['Code128', 'EAN-13', 'Code39', 'QRCode'],
              tryHarder: isDeepScan,
              tryRotate: isDeepScan,
              tryInvert: isDeepScan,
              binarizer: isDeepScan ? 'LocalAverage' : 'GlobalHistogram',
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
        // Tần số quét cao trực tiếp theo nhịp 60Hz của màn hình (khoảng ~40 FPS)
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

        // Kiểm tra đèn pin & kích hoạt lấy nét liên tục (Continuous Autofocus)
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          try {
            const capabilities = videoTrack.getCapabilities?.() as any;
            if (capabilities && capabilities.torch) {
              setHasTorch(true);
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

        // Khởi động vòng giải mã C++ WebAssembly
        startWasmScanLoop();
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
    [stopCamera, startWasmScanLoop]
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
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Động cơ: ZXing C++ WASM Turbo • Quét & chụp liên tục
            </span>
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
                  {scanIdleSeconds < 3 && '🎯 Đưa mã vạch vào khung (khoảng cách 15-20cm)'}
                  {scanIdleSeconds >= 3 && scanIdleSeconds < 6 && '💡 Chưa đọc được? Hãy đưa gần hơn 15-20cm & giữ chắc tay'}
                  {scanIdleSeconds >= 6 && '⚡ Tem mờ/lóa? Thử bật đèn flash hoặc bấm [📷 Chụp ảnh] để lấy nét'}
                </div>
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                flex: 2,
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
              style={{ flex: 1, fontSize: '0.85rem', padding: '8px 10px' }}
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
