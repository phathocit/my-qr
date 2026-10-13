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
  const [inAppNotice, setInAppNotice] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const loadingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const zxingReaderRef = useRef<any>(null);
  const isHandlingDetectionRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const facingModeRef = useRef<'environment' | 'user'>('environment');
  // Guard: tránh gọi play() nhiều lần đồng thời
  const isPlayingRef = useRef(false);
  // Guard: tránh startScanningLoop chạy 2 lần
  const scanLoopStartedRef = useRef(false);

  facingModeRef.current = facingMode;

  // ─── Dừng toàn bộ camera stream & scanner loop ───────────────────────────
  const stopCamera = useCallback(() => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
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
      streamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch {}
    }
    isPlayingRef.current = false;
    scanLoopStartedRef.current = false;
    setCameraActive(false);
    setIsLoadingCamera(false);
    setNeedsTapToPlay(false);
  }, []);

  // ─── Chụp khung hình đối chiếu ───────────────────────────────────────────
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

  // ─── Khởi động vòng quét (chỉ chạy 1 lần) ───────────────────────────────
  const startScanningLoop = useCallback(async () => {
    // Chặn double-start
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
        setEngineUsed('BarcodeDetector (Native)');
        scanIntervalRef.current = setInterval(async () => {
          const v = videoRef.current;
          if (!v || v.readyState < 2 || v.paused || isHandlingDetectionRef.current) return;
          try {
            const barcodes = await barcodeDetector.detect(v);
            if (barcodes.length > 0 && barcodes[0].rawValue) onCodeFound(barcodes[0].rawValue);
          } catch {}
        }, 300);
        return;
      } catch (e) {
        console.warn('BarcodeDetector init failed, using ZXing:', e);
      }
    }

    try {
      setEngineUsed('ZXing (Client)');
      const { BrowserMultiFormatReader } = await import('@zxing/library');
      const reader = new BrowserMultiFormatReader();
      zxingReaderRef.current = reader;
      scanIntervalRef.current = setInterval(async () => {
        const v = videoRef.current;
        if (!v || v.readyState < 2 || v.paused || isHandlingDetectionRef.current) return;
        try {
          const result = await reader.decodeFromVideoElement(v);
          if (result?.getText()) onCodeFound(result.getText());
        } catch {}
      }, 350);
    } catch (err) {
      console.warn('ZXing load failed:', err);
    }
  }, [onCodeFound]);

  // ─── Hàm kích hoạt video an toàn (chống double-call) ────────────────────
  const activateVideo = useCallback((videoEl: HTMLVideoElement) => {
    // Đã đang kích hoạt hoặc đã active → bỏ qua
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    const doPlay = () => {
      if (!videoEl.srcObject) {
        isPlayingRef.current = false;
        return;
      }
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // Thành công — state sẽ được cập nhật qua sự kiện onPlaying
          })
          .catch((err: any) => {
            isPlayingRef.current = false;
            if (err?.name === 'AbortError') {
              // iOS Safari: stream chưa sẵn sàng, thử lại sau 200ms
              setTimeout(() => {
                isPlayingRef.current = false;
                activateVideo(videoEl);
              }, 200);
            } else if (err?.name === 'NotAllowedError') {
              setNeedsTapToPlay(true);
              setIsLoadingCamera(false);
            } else {
              console.warn('play() failed:', err?.name, err?.message);
              setNeedsTapToPlay(true);
              setIsLoadingCamera(false);
            }
          });
      }
    };

    // Nếu chưa có metadata, đợi loadedmetadata rồi mới play
    if (videoEl.readyState >= 1) {
      doPlay();
    } else {
      videoEl.addEventListener('loadedmetadata', doPlay, { once: true });
    }
  }, []);

  // ─── Khởi động camera ─────────────────────────────────────────────────────
  const startCamera = useCallback(async (targetFacing?: 'environment' | 'user', specificDeviceId?: string) => {
    const desiredFacing = targetFacing || facingModeRef.current;

    // Reset guards
    isPlayingRef.current = false;
    scanLoopStartedRef.current = false;

    // Dừng luồng cũ
    if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null; }
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      streamRef.current = null;
    }
    if (videoRef.current) {
      try { videoRef.current.pause(); videoRef.current.srcObject = null; } catch {}
    }

    setCameraError(null);
    setNeedsTapToPlay(false);
    setIsLoadingCamera(true);
    setCameraActive(false);
    isHandlingDetectionRef.current = false;

    // Kiểm tra HTTPS
    if (typeof window !== 'undefined') {
      const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      if (!window.isSecureContext && !isLocal) {
        setCameraError('Camera yêu cầu HTTPS. Vui lòng truy cập qua link Vercel (https://...).');
        setIsLoadingCamera(false);
        return;
      }
      // In-app browser detection
      const ua = navigator.userAgent || '';
      if (/FBAN|FBAV|Instagram|Zalo|Line|MicroMessenger/i.test(ua)) {
        setInAppNotice(true);
      }
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError('Trình duyệt không hỗ trợ camera trực tiếp. Bấm "📷 Chụp ảnh bằng máy" bên dưới.');
      setIsLoadingCamera(false);
      return;
    }

    // Đợi phần cứng cũ giải phóng
    await new Promise((r) => setTimeout(r, 150));

    let stream: MediaStream | null = null;
    let lastError: any = null;

    // Thử 1: deviceId cụ thể
    if (specificDeviceId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: specificDeviceId } },
          audio: false,
        });
      } catch (e) {
        console.warn('Thất bại với deviceId, thử facingMode:', e);
      }
    }

    // Thử 2: facingMode lý tưởng
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: desiredFacing } },
          audio: false,
        });
      } catch (e1) {
        lastError = e1;
        // Thử 3: tối giản
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (e2) {
          lastError = e2;
        }
      }
    }

    if (!stream) {
      const isDenied = lastError?.name === 'NotAllowedError' || lastError?.name === 'PermissionDeniedError';
      setCameraError(isDenied
        ? 'Quyền camera bị từ chối. Vào Cài đặt trình duyệt → bật Camera, hoặc bấm "📷 Chụp ảnh bằng máy".'
        : 'Không thể mở camera. Bấm "📷 Chụp ảnh bằng máy" hoặc nhập mã thủ công.'
      );
      setIsLoadingCamera(false);
      return;
    }

    streamRef.current = stream;

    // Liệt kê camera sau khi đã có stream (để browser cấp label)
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAvailableDevices(devices.filter((d) => d.kind === 'videoinput'));
    } catch {}

    // Thiết lập bộ đếm thời gian an toàn 5s
    loadingTimerRef.current = setTimeout(() => {
      // Nếu sau 5s vẫn chưa active → hiện tap-to-play
      setCameraActive((active) => {
        if (!active) {
          isPlayingRef.current = false;
          setNeedsTapToPlay(true);
          setIsLoadingCamera(false);
        }
        return active;
      });
    }, 5000);

    const video = videoRef.current;
    if (!video) {
      setIsLoadingCamera(false);
      return;
    }

    // ── Thiết lập thuộc tính TRƯỚC khi gán srcObject (quy tắc Safari iOS) ──
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('x-webkit-airplay', 'allow');
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');

    // Gán stream — dùng requestAnimationFrame để đảm bảo DOM đã paint
    requestAnimationFrame(() => {
      if (!videoRef.current || !streamRef.current) return;
      videoRef.current.srcObject = streamRef.current;
      activateVideo(videoRef.current);
    });
  }, [activateVideo]);

  // ─── Xử lý upload ảnh để quét ────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoadingCamera(true);
    setCameraError(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const originalDataUrl = evt.target?.result as string;
      if (!originalDataUrl) { setIsLoadingCamera(false); return; }

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
            if (codes.length > 0 && codes[0].rawValue) foundCode = codes[0].rawValue;
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
          setCameraError('Không tìm thấy mã vạch. Hãy chụp lại ở cự ly gần, đủ ánh sáng.');
        }
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ─── Đổi camera ──────────────────────────────────────────────────────────
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

  // ─── Tap-to-play khi autoplay bị chặn ───────────────────────────────────
  const handleUserTapToPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    // Gán lại stream nếu bị mất
    if (!video.srcObject && streamRef.current) {
      video.srcObject = streamRef.current;
    }
    setNeedsTapToPlay(false);
    isPlayingRef.current = false;
    activateVideo(video);
  };

  // ─── Lifecycle ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setCapturedPhoto(null);
      setDetectedCode(null);
      setCameraError(null);
      setInAppNotice(false);
      isHandlingDetectionRef.current = false;
      // Đợi modal mount hoàn toàn rồi mới startCamera
      const t = setTimeout(() => startCamera(), 80);
      return () => { clearTimeout(t); stopCamera(); };
    } else {
      stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    onDetected(manualCode.trim());
    onClose();
  };

  const handleConfirmDetected = () => {
    if (detectedCode) { onDetected(detectedCode, capturedPhoto || undefined); onClose(); }
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
                Động cơ: {engineUsed}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        {/* Cảnh báo in-app browser */}
        {inAppNotice && (
          <div style={{ fontSize: '0.75rem', background: '#3b2505', color: '#fed7aa', padding: '6px 10px', borderRadius: 'var(--radius-sm)', marginTop: 8 }}>
            ⚠️ Đang mở trong ứng dụng khác. Nếu camera bị đen, bấm menu ⋮ → <strong>Mở bằng Chrome / Safari</strong>.
          </div>
        )}

        {/* Kết quả quét */}
        {detectedCode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>

            {/* Khung camera */}
            <div style={{ position: 'relative', width: '100%', height: 290, background: '#050810', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>

              {/* Video element — luôn render trong DOM */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onPlaying={() => {
                  // Đây là sự kiện đáng tin cậy nhất: stream đang thực sự phát hình
                  if (loadingTimerRef.current) {
                    clearTimeout(loadingTimerRef.current);
                    loadingTimerRef.current = null;
                  }
                  setIsLoadingCamera(false);
                  setNeedsTapToPlay(false);
                  setCameraActive(true);
                  // Khởi scan loop — guard bên trong sẽ chặn double-call
                  startScanningLoop();
                }}
                onStalled={() => {
                  // Stream bị treo: thử play lại
                  if (videoRef.current && streamRef.current) {
                    isPlayingRef.current = false;
                    activateVideo(videoRef.current);
                  }
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                  // QUAN TRỌNG: KHÔNG đặt background #000 vì sẽ che stream trên một số WebKit
                }}
              />

              {/* Loading overlay */}
              {isLoadingCamera && !cameraError && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(5,8,16,0.85)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', gap: 10, zIndex: 5,
                }}>
                  <div style={{ width: 30, height: 30, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  <span style={{ fontSize: '0.85rem' }}>Đang kết nối camera...</span>
                  <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)' }}>Bấm &ldquo;Cho phép&rdquo; nếu máy hỏi quyền</span>
                </div>
              )}

              {/* Tap-to-play overlay */}
              {needsTapToPlay && !isLoadingCamera && !cameraError && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(5,8,16,0.8)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 14, zIndex: 7, padding: 16, textAlign: 'center',
                }}>
                  <span style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>Camera đã kết nối. Bấm để bắt đầu:</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '12px 24px', fontSize: '1rem', fontWeight: 700 }}
                    onClick={handleUserTapToPlay}
                  >
                    ▶ Bật Camera
                  </button>
                </div>
              )}

              {/* Viewfinder khi active */}
              {cameraActive && !isLoadingCamera && !needsTapToPlay && !cameraError && (
                <div style={{
                  position: 'absolute', top: '15%', left: '8%', width: '84%', height: '70%',
                  border: '2px solid rgba(59,130,246,0.9)', borderRadius: 14,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.42)', pointerEvents: 'none', zIndex: 4,
                }}>
                  {/* Thanh quét chạy dọc */}
                  <div style={{
                    position: 'absolute', top: '50%', left: 0, right: 0,
                    height: 2, background: 'rgba(59,130,246,0.8)',
                    boxShadow: '0 0 8px #3b82f6', transform: 'translateY(-50%)',
                  }} />
                  {/* 4 góc highlight */}
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

              {/* Error overlay */}
              {cameraError && (
                <div style={{
                  position: 'absolute', inset: 0, padding: 16, textAlign: 'center',
                  color: '#fca5a5', fontSize: '0.85rem', background: 'rgba(15,23,42,0.95)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 8,
                }}>
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

            {/* Nút điều khiển */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 2, fontSize: '0.85rem', padding: '9px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
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
                title="Đổi camera trước / sau"
              >
                🔄 Đổi cam
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

        {/* Nhập thủ công */}
        {allowManual && (
          <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
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
