'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (code: string, photoDataUrl?: string) => void;
  title?: string;
  allowManual?: boolean;
}

export default function ScannerModal({
  isOpen,
  onClose,
  onDetected,
  title = 'Quét mã Barcode / QR',
  allowManual = true,
}: ScannerModalProps) {
  const [manualCode, setManualCode] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [isLoadingCamera, setIsLoadingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [detectedCode, setDetectedCode] = useState<string | null>(null);
  const [engineUsed, setEngineUsed] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState<number>(0);
  const [activeResolution, setActiveResolution] = useState<string>('');
  const [inAppNotice, setInAppNotice] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const zxingReaderRef = useRef<any>(null);
  const isHandlingDetectionRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const facingModeRef = useRef<'environment' | 'user'>('environment');
  const scanLoopStartedRef = useRef(false);

  facingModeRef.current = facingMode;

  // ─── Dừng toàn bộ camera stream & scanner loop ───────────────────────────
  const stopCamera = useCallback(() => {
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (zxingReaderRef.current) {
      try {
        zxingReaderRef.current.reset();
      } catch {}
      zxingReaderRef.current = null;
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
    scanLoopStartedRef.current = false;
    setCameraActive(false);
    setIsLoadingCamera(false);
    setNeedsTapToPlay(false);
    setActiveResolution('');
  }, []);

  // ─── Chụp khung hình đối chiếu khi phát hiện mã ─────────────────────────
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

  // ─── Khi tìm thấy mã barcode/QR ──────────────────────────────────────────
  const onCodeFound = useCallback((code: string, customPhoto?: string) => {
    if (isHandlingDetectionRef.current) return;
    isHandlingDetectionRef.current = true;
    const trimmed = code.trim();
    if (!trimmed) return;
    const photo = customPhoto || captureFrame();
    stopCamera();
    setDetectedCode(trimmed);
    if (photo) setCapturedPhoto(photo);
  }, [captureFrame, stopCamera]);

  // ─── Khởi động vòng quét barcode/QR ─────────────────────────────────────
  const startScanningLoop = useCallback(async () => {
    if (scanLoopStartedRef.current) return;
    scanLoopStartedRef.current = true;

    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    const BarcodeDetectorClass = typeof window !== 'undefined' ? (window as any).BarcodeDetector : null;

    if (BarcodeDetectorClass) {
      try {
        let supportedFormats = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8'];
        if (typeof BarcodeDetectorClass.getSupportedFormats === 'function') {
          try {
            const available = await BarcodeDetectorClass.getSupportedFormats();
            if (Array.isArray(available) && available.length > 0) supportedFormats = available;
          } catch {}
        }
        const barcodeDetector = new BarcodeDetectorClass({ formats: supportedFormats });
        setEngineUsed('BarcodeDetector (Chuẩn gốc)');

        scanIntervalRef.current = setInterval(async () => {
          const v = videoRef.current;
          if (!v || v.readyState < 2 || v.paused || isHandlingDetectionRef.current) return;
          try {
            const barcodes = await barcodeDetector.detect(v);
            if (barcodes.length > 0 && barcodes[0]?.rawValue) {
              onCodeFound(barcodes[0].rawValue);
            }
          } catch {}
        }, 250);
        return;
      } catch (e) {
        console.warn('BarcodeDetector init failed, using ZXing:', e);
      }
    }

    // ZXing fallback cho iOS Safari và trình duyệt không có BarcodeDetector
    try {
      setEngineUsed('ZXing Library');
      const { BrowserMultiFormatReader } = await import('@zxing/library');
      const reader = new BrowserMultiFormatReader();
      zxingReaderRef.current = reader;

      const v = videoRef.current;
      if (!v) return;

      // decodeFromVideoElementContinuously là hàm chuẩn của ZXing cho continuous scan
      // Tuyệt đối không gọi reader.decodeFromVideoElement trong setInterval vì nó tự gọi reset() mỗi frame!
      reader.decodeFromVideoElementContinuously(v, (result: any) => {
        if (result && result.getText && !isHandlingDetectionRef.current) {
          const text = result.getText();
          if (text) onCodeFound(text);
        }
      });
    } catch (err) {
      console.warn('ZXing load failed:', err);
    }
  }, [onCodeFound]);

  // ─── Khởi động camera trực tiếp ──────────────────────────────────────────
  const startCamera = useCallback(async (targetFacing?: 'environment' | 'user', specificDeviceId?: string) => {
    const desiredFacing = targetFacing || facingModeRef.current;

    // Reset cờ và dọn dẹp camera cũ
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (zxingReaderRef.current) {
      try { zxingReaderRef.current.reset(); } catch {}
      zxingReaderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch {}
    }

    scanLoopStartedRef.current = false;
    setCameraError(null);
    setNeedsTapToPlay(false);
    setIsLoadingCamera(true);
    setCameraActive(false);
    setActiveResolution('');
    isHandlingDetectionRef.current = false;

    // Kiểm tra HTTPS
    if (typeof window !== 'undefined') {
      const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      if (!window.isSecureContext && !isLocal) {
        setCameraError('Camera yêu cầu HTTPS. Vui lòng mở trang web qua link https://');
        setIsLoadingCamera(false);
        return;
      }
      const ua = navigator.userAgent || '';
      if (/FBAN|FBAV|Instagram|Zalo|Line|MicroMessenger/i.test(ua)) {
        setInAppNotice(true);
      }
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError('Trình duyệt không hỗ trợ mở camera trực tiếp. Vui lòng bấm "📷 Chụp ảnh bằng máy" bên dưới.');
      setIsLoadingCamera(false);
      return;
    }

    // Chờ 100ms để phần cứng giải phóng tài nguyên
    await new Promise((r) => setTimeout(r, 100));

    let stream: MediaStream | null = null;
    let lastError: any = null;

    // 1. Nếu có deviceId cụ thể
    if (specificDeviceId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: specificDeviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (e) {
        console.warn('Lỗi với deviceId cụ thể, thử chuyển sang facingMode:', e);
      }
    }

    // 2. Thử với facingMode lý tưởng (back hoặc front camera)
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: desiredFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (e1) {
        lastError = e1;
        // 3. Dự phòng tối giản: chỉ yêu cầu video: true
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (e2) {
          lastError = e2;
        }
      }
    }

    if (!stream) {
      const isDenied = lastError?.name === 'NotAllowedError' || lastError?.name === 'PermissionDeniedError';
      setCameraError(
        isDenied
          ? 'Quyền camera bị từ chối. Vào Cài đặt trình duyệt → bật Cho phép Camera, hoặc bấm "📷 Chụp ảnh bằng máy".'
          : 'Không thể mở camera. Bấm "📷 Chụp ảnh bằng máy" hoặc nhập mã thủ công.'
      );
      setIsLoadingCamera(false);
      return;
    }

    streamRef.current = stream;

    // Liệt kê danh sách các camera trên thiết bị
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setAvailableDevices(videoInputs);
    } catch {}

    const video = videoRef.current;
    if (!video) {
      setIsLoadingCamera(false);
      return;
    }

    // Thiết lập thuộc tính bắt buộc cho iOS Safari & Android Chrome
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');

    // Gán MediaStream trực tiếp vào video
    video.srcObject = stream;

    // GỌI video.play() NGAY LẬP TỨC:
    // Tuyệt đối không chờ loadedmetadata mới play, vì trên mobile Safari / Chrome nếu không gọi play() thì loadedmetadata sẽ KHÔNG BAO GIỜ FIRE (gây deadlock màn hình đen)
    try {
      await video.play();
      setIsLoadingCamera(false);
      setCameraActive(true);
      setNeedsTapToPlay(false);

      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setActiveResolution(`${video.videoWidth}x${video.videoHeight}`);
      }
      startScanningLoop();
    } catch (playError: any) {
      console.warn('video.play() bị trình duyệt hoãn / chặn tự phát:', playError);
      setIsLoadingCamera(false);
      if (playError?.name === 'NotAllowedError') {
        setNeedsTapToPlay(true);
      } else {
        // Cho phép người dùng chạm để kích hoạt
        setNeedsTapToPlay(true);
      }
    }

    // Safety timeout: nếu sau 4 giây vẫn chưa thấy hình
    safetyTimeoutRef.current = setTimeout(() => {
      if (videoRef.current && (videoRef.current.paused || videoRef.current.videoWidth === 0)) {
        setIsLoadingCamera(false);
        setNeedsTapToPlay(true);
      }
    }, 4000);
  }, [startScanningLoop]);

  // ─── Tap-to-play khi autoplay bị chính sách trình duyệt chặn ───────────────
  const handleUserTapToPlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (!video.srcObject && streamRef.current) {
        video.srcObject = streamRef.current;
      }
      video.muted = true;
      await video.play();
      setNeedsTapToPlay(false);
      setIsLoadingCamera(false);
      setCameraActive(true);
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setActiveResolution(`${video.videoWidth}x${video.videoHeight}`);
      }
      startScanningLoop();
    } catch (err) {
      console.error('Lỗi khi bấm phát video:', err);
      setCameraError('Trình duyệt không cho phép phát camera trực tiếp. Vui lòng bấm "📷 Chụp ảnh bằng máy" bên dưới.');
    }
  };

  // ─── Xử lý upload hoặc chụp ảnh từ camera gốc ────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoadingCamera(true);
    setCameraError(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const originalDataUrl = evt.target?.result as string;
      if (!originalDataUrl) {
        setIsLoadingCamera(false);
        return;
      }

      const img = new Image();
      img.onload = async () => {
        const maxDim = 1600;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { setIsLoadingCamera(false); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

        let foundCode: string | null = null;

        const BarcodeDetectorClass = typeof window !== 'undefined' ? (window as any).BarcodeDetector : null;
        if (BarcodeDetectorClass) {
          try {
            const codes = await new BarcodeDetectorClass().detect(canvas);
            if (codes.length > 0 && codes[0]?.rawValue) foundCode = codes[0].rawValue;
          } catch {}
        }

        if (!foundCode) {
          try {
            const { BrowserMultiFormatReader } = await import('@zxing/library');
            const res = await new BrowserMultiFormatReader().decodeFromImageUrl(dataUrl);
            if (res?.getText()) foundCode = res.getText();
          } catch {}
        }

        setIsLoadingCamera(false);
        if (foundCode) {
          onCodeFound(foundCode, dataUrl);
        } else {
          setCameraError('Không tìm thấy mã vạch trong ảnh chụp. Hãy chụp lại ở cự ly gần và đủ ánh sáng.');
        }
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ─── Đổi camera (trước / sau hoặc các ống kính khác) ─────────────────────
  const handleCycleCamera = () => {
    if (availableDevices.length > 1) {
      const nextIndex = (currentDeviceIndex + 1) % availableDevices.length;
      setCurrentDeviceIndex(nextIndex);
      startCamera(undefined, availableDevices[nextIndex].deviceId);
    } else {
      const newMode = facingMode === 'environment' ? 'user' : 'environment';
      setFacingMode(newMode);
      startCamera(newMode);
    }
  };

  // ─── Vòng đời modal ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setCapturedPhoto(null);
      setDetectedCode(null);
      setCameraError(null);
      setInAppNotice(false);
      isHandlingDetectionRef.current = false;
      // Chờ 150ms để modal animation ổn định trong DOM rồi mở camera
      const t = setTimeout(() => {
        startCamera();
      }, 150);
      return () => {
        clearTimeout(t);
        stopCamera();
      };
    } else {
      stopCamera();
    }
  }, [isOpen, startCamera, stopCamera]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    onDetected(manualCode.trim());
    onClose();
  };

  const handleConfirmDetected = () => {
    if (detectedCode) {
      onDetected(detectedCode, capturedPhoto || undefined);
      onClose();
    }
  };

  const handleRescan = () => {
    setDetectedCode(null);
    setCapturedPhoto(null);
    isHandlingDetectionRef.current = false;
    startCamera();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{title}</h3>
            {engineUsed && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Động cơ: {engineUsed} {activeResolution ? `(${activeResolution})` : ''}
              </span>
            )}
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
            ⚠️ Đang mở trong ứng dụng khác. Nếu camera bị đen, hãy bấm menu ⋮ → <strong>Mở bằng Chrome / Safari</strong>.
          </div>
        )}

        {/* Kết quả nhận diện */}
        {detectedCode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <div className="toast-notice info">
              <span>Đã nhận diện: <strong>{detectedCode}</strong></span>
            </div>
            {capturedPhoto && (
              <div style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '2px solid var(--primary)', position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={capturedPhoto} alt="Khung hình đối chiếu" style={{ width: '100%', height: 'auto', display: 'block' }} />
                <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4 }}>
                  Khung hình đối chiếu
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleRescan}>Quét lại</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirmDetected}>✓ Xác nhận mã</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
            {/* Khung hiển thị camera */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 290,
                background: '#090d16',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}
            >
              {/* Thẻ video gắn MediaStream */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onPlaying={() => {
                  if (safetyTimeoutRef.current) {
                    clearTimeout(safetyTimeoutRef.current);
                    safetyTimeoutRef.current = null;
                  }
                  setIsLoadingCamera(false);
                  setNeedsTapToPlay(false);
                  setCameraActive(true);
                  if (videoRef.current && videoRef.current.videoWidth > 0) {
                    setActiveResolution(`${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);
                  }
                  startScanningLoop();
                }}
                onLoadedMetadata={() => {
                  if (videoRef.current && videoRef.current.videoWidth > 0) {
                    setActiveResolution(`${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);
                  }
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />

              {/* Loading overlay */}
              {isLoadingCamera && !cameraError && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(9, 13, 22, 0.85)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    gap: 10,
                    zIndex: 5,
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
                  <span style={{ fontSize: '0.85rem' }}>Đang kết nối camera...</span>
                  <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)' }}>
                    Bấm &ldquo;Cho phép&rdquo; nếu trình duyệt hỏi quyền
                  </span>
                </div>
              )}

              {/* Tap to play nếu autoplay bị chặn */}
              {needsTapToPlay && !isLoadingCamera && !cameraError && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(9, 13, 22, 0.82)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 14,
                    zIndex: 7,
                    padding: 16,
                    textAlign: 'center',
                  }}
                >
                  <span style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>
                    Camera đã sẵn sàng. Chạm bên dưới để hiển thị hình ảnh:
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '12px 26px', fontSize: '1rem', fontWeight: 700 }}
                    onClick={handleUserTapToPlay}
                  >
                    ▶ Bật hiển thị Camera
                  </button>
                </div>
              )}

              {/* Viewfinder khung ngắm quét */}
              {cameraActive && !isLoadingCamera && !needsTapToPlay && !cameraError && (
                <div
                  style={{
                    position: 'absolute',
                    top: '15%',
                    left: '8%',
                    width: '84%',
                    height: '70%',
                    border: '2px solid rgba(59,130,246,0.9)',
                    borderRadius: 14,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.42)',
                    pointerEvents: 'none',
                    zIndex: 4,
                  }}
                >
                  {/* Tia laser quét ngang */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: 0,
                      right: 0,
                      height: 2,
                      background: 'rgba(59,130,246,0.85)',
                      boxShadow: '0 0 8px #3b82f6',
                      transform: 'translateY(-50%)',
                    }}
                  />
                  {/* 4 góc ngắm */}
                  {[
                    { top: -2, left: -2, borderTop: '3px solid #60a5fa', borderLeft: '3px solid #60a5fa', borderRight: 'none', borderBottom: 'none' },
                    { top: -2, right: -2, borderTop: '3px solid #60a5fa', borderRight: '3px solid #60a5fa', borderLeft: 'none', borderBottom: 'none' },
                    { bottom: -2, left: -2, borderBottom: '3px solid #60a5fa', borderLeft: '3px solid #60a5fa', borderRight: 'none', borderTop: 'none' },
                    { bottom: -2, right: -2, borderBottom: '3px solid #60a5fa', borderRight: '3px solid #60a5fa', borderLeft: 'none', borderTop: 'none' },
                  ].map((s, i) => (
                    <div key={i} style={{ position: 'absolute', width: 20, height: 20, borderRadius: 2, ...s }} />
                  ))}
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
                    zIndex: 8,
                  }}
                >
                  <div style={{ lineHeight: 1.5 }}>{cameraError}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => startCamera()}>
                      🔄 Thử lại
                    </button>
                    <button className="btn btn-primary" style={{ fontSize: '0.8rem' }} onClick={() => fileInputRef.current?.click()}>
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
                  padding: '9px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <span>📷</span>
                <span>Chụp ảnh bằng máy (Khuyên dùng)</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1, fontSize: '0.85rem', padding: '9px 10px' }}
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
        )}

        {/* Nhập mã thủ công */}
        {allowManual && (
          <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <div className="form-label">Hoặc nhập SN / Mã quản lý thủ công:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="input"
                placeholder="VD: SN-12345678"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                Xác nhận
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
