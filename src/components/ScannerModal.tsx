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

  facingModeRef.current = facingMode;

  // Dừng toàn bộ camera stream & scanner loop
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
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setIsLoadingCamera(false);
    setNeedsTapToPlay(false);
  }, []);

  // Chụp lại khung hình video hiện tại để đối chiếu
  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

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

  // Khi tìm thấy mã barcode/QR
  const onCodeFound = useCallback((code: string, customPhoto?: string) => {
    if (isHandlingDetectionRef.current) return;
    isHandlingDetectionRef.current = true;

    const trimmed = code.trim();
    if (!trimmed) return;

    // Chụp lại khung hình đối chiếu rồi dừng camera
    const photo = customPhoto || captureFrame();
    stopCamera();

    setDetectedCode(trimmed);
    if (photo) setCapturedPhoto(photo);
  }, [captureFrame, stopCamera]);

  // Vòng lặp giải mã Barcode/QR
  const startScanningLoop = useCallback(async () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    const BarcodeDetectorClass = typeof window !== 'undefined' ? (window as any).BarcodeDetector : null;

    // 1. Thử BarcodeDetector native của trình duyệt (Chrome Android, Edge, etc.)
    if (BarcodeDetectorClass) {
      try {
        let supportedFormats = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8'];
        if (typeof BarcodeDetectorClass.getSupportedFormats === 'function') {
          try {
            const available = await BarcodeDetectorClass.getSupportedFormats();
            if (Array.isArray(available) && available.length > 0) {
              supportedFormats = available;
            }
          } catch {}
        }

        const barcodeDetector = new BarcodeDetectorClass({ formats: supportedFormats });
        setEngineUsed('BarcodeDetector (Native)');

        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2 || isHandlingDetectionRef.current) return;
          try {
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              onCodeFound(barcodes[0].rawValue);
            }
          } catch {}
        }, 250);
        return;
      } catch (e) {
        console.warn('Native BarcodeDetector init failed, falling back to ZXing', e);
      }
    }

    // 2. Dự phòng bằng @zxing/library (Hỗ trợ 100% iOS Safari & mọi trình duyệt)
    try {
      setEngineUsed('ZXing Engine (Client)');
      const { BrowserMultiFormatReader } = await import('@zxing/library');
      const reader = new BrowserMultiFormatReader();
      zxingReaderRef.current = reader;

      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2 || isHandlingDetectionRef.current) return;
        try {
          const result = await reader.decodeFromVideoElement(videoRef.current);
          if (result && result.getText()) {
            onCodeFound(result.getText());
          }
        } catch {
          // Frame chưa có barcode
        }
      }, 280);
    } catch (err) {
      console.warn('Failed to load @zxing/library', err);
    }
  }, [onCodeFound]);

  // Kích hoạt phát video an toàn cho Safari / Chrome Mobile
  const playVideoSafely = useCallback(async (videoEl: HTMLVideoElement) => {
    try {
      await videoEl.play();
      setNeedsTapToPlay(false);
      setIsLoadingCamera(false);
      setCameraActive(true);
      startScanningLoop();
    } catch (playErr) {
      console.warn('video.play() rejected (autoplay policy / user gesture needed):', playErr);
      // Hiển thị nút "Chạm để bật camera" cho người dùng
      setNeedsTapToPlay(true);
      setIsLoadingCamera(false);
    }
  }, [startScanningLoop]);

  // Khởi động Camera
  const startCamera = useCallback(async (targetFacing?: 'environment' | 'user', specificDeviceId?: string) => {
    const desiredFacing = targetFacing || facingModeRef.current;

    // Dừng luồng cũ
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
    }
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
      });
      streamRef.current = null;
    }

    setCameraError(null);
    setNeedsTapToPlay(false);
    setIsLoadingCamera(true);
    isHandlingDetectionRef.current = false;

    // Kiểm tra môi trường HTTPS
    if (typeof window !== 'undefined') {
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!window.isSecureContext && !isLocal) {
        setCameraError('Camera yêu cầu kết nối bảo mật HTTPS. Vui lòng truy cập qua link HTTPS (domain Vercel) trên điện thoại.');
        setIsLoadingCamera(false);
        return;
      }

      // Nhận diện in-app browser (Zalo, Facebook, Messenger)
      const ua = navigator.userAgent || '';
      if (/FBAN|FBAV|Instagram|Zalo|Line|MicroMessenger/i.test(ua)) {
        setInAppNotice(true);
      }
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Trình duyệt không hỗ trợ mở camera trực tiếp. Vui lòng bấm "📷 Chụp ảnh bằng máy" bên dưới hoặc mở trang bằng Safari / Chrome.');
      setIsLoadingCamera(false);
      return;
    }

    // Đợi 120ms để driver camera hệ điều hành kịp giải phóng phần cứng cũ
    await new Promise((r) => setTimeout(r, 120));

    // Thiết lập bộ đếm an toàn: sau 3.5 giây nếu vẫn đang loading, tự động tắt loading để người dùng không bị kẹt
    loadingTimerRef.current = setTimeout(() => {
      setIsLoadingCamera((curr) => {
        if (curr) {
          if (videoRef.current && videoRef.current.paused) {
            setNeedsTapToPlay(true);
          }
          return false;
        }
        return false;
      });
    }, 3500);

    let stream: MediaStream | null = null;
    let lastError: any = null;

    // 1. Thử lấy camera theo Device ID cụ thể nếu có
    if (specificDeviceId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: specificDeviceId } },
          audio: false,
        });
      } catch (err) {
        console.warn('Failed to get camera by specific deviceId, falling back to facingMode:', err);
      }
    }

    // 2. Thử lấy camera theo facingMode lý tưởng (không gán cứng width/height cố định để tránh lỗi ngược tỷ lệ trên màn hình dọc)
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: desiredFacing },
          },
          audio: false,
        });
      } catch (err1) {
        lastError = err1;
        console.warn('getUserMedia với facingMode thất bại, thử cấu hình tối giản video: true:', err1);
        try {
          // 3. Fallback tối giản nhất
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } catch (err2) {
          lastError = err2;
        }
      }
    }

    if (!stream) {
      console.warn('Không thể kết nối camera:', lastError);
      const isPermissionDenied = lastError?.name === 'NotAllowedError' || lastError?.name === 'PermissionDeniedError';
      setCameraError(
        isPermissionDenied
          ? 'Quyền truy cập Camera bị từ chối. Vui lòng vào Cài đặt trình duyệt trên máy để bật quyền Camera, hoặc bấm "Chụp ảnh bằng máy" bên dưới.'
          : 'Không thể khởi động camera trực tiếp. Bạn hãy bấm "📷 Chụp ảnh bằng máy" hoặc nhập mã thủ công.'
      );
      setIsLoadingCamera(false);
      return;
    }

    streamRef.current = stream;

    // Liệt kê các camera khả dụng để hỗ trợ đổi camera
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setAvailableDevices(videoInputs);
    } catch {}

    // Gán luồng vào thẻ Video với đầy đủ thuộc tính bắt buộc của iOS Safari WebKit
    const video = videoRef.current;
    if (video) {
      // Cấu hình thuộc tính DOM TRƯỚC KHI gán srcObject (Quy tắc vàng của Safari iOS)
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.setAttribute('muted', 'true');
      video.setAttribute('autoplay', 'true');

      video.srcObject = stream;

      // Kích hoạt play
      await playVideoSafely(video);
    }
  }, [playVideoSafely]);

  // Quét Barcode từ File ảnh (Tải lên hoặc Chụp bằng Camera gốc của hệ điều hành)
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
        // Tối ưu hóa kích thước ảnh (Scale xuống tối đa 1600px để giải mã tức thì, tránh tràn RAM trên mobile)
        const maxDimension = 1600;
        let targetW = img.width;
        let targetH = img.height;
        if (targetW > maxDimension || targetH > maxDimension) {
          if (targetW > targetH) {
            targetH = Math.round((targetH * maxDimension) / targetW);
            targetW = maxDimension;
          } else {
            targetW = Math.round((targetW * maxDimension) / targetH);
            targetH = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setIsLoadingCamera(false);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const processedDataUrl = canvas.toDataURL('image/jpeg', 0.88);

        let foundCode: string | null = null;

        // 1. Thử BarcodeDetector native
        const BarcodeDetectorClass = typeof window !== 'undefined' ? (window as any).BarcodeDetector : null;
        if (BarcodeDetectorClass) {
          try {
            const detector = new BarcodeDetectorClass();
            const codes = await detector.detect(canvas);
            if (codes.length > 0 && codes[0].rawValue) {
              foundCode = codes[0].rawValue;
            }
          } catch {}
        }

        // 2. Dự phòng bằng ZXing
        if (!foundCode) {
          try {
            const { BrowserMultiFormatReader } = await import('@zxing/library');
            const zxReader = new BrowserMultiFormatReader();
            const res = await zxReader.decodeFromImageUrl(processedDataUrl);
            if (res && res.getText()) {
              foundCode = res.getText();
            }
          } catch {}
        }

        setIsLoadingCamera(false);

        if (foundCode) {
          onCodeFound(foundCode, processedDataUrl);
        } else {
          setCameraError('Không tìm thấy mã vạch trong ảnh đã chụp. Bạn vui lòng chụp lại ở cự ly gần và đủ ánh sáng.');
        }
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Chuyển đổi qua lại giữa các camera
  const handleCycleCamera = () => {
    if (availableDevices.length > 1) {
      const nextIndex = (currentDeviceIndex + 1) % availableDevices.length;
      setCurrentDeviceIndex(nextIndex);
      const nextDevice = availableDevices[nextIndex];
      startCamera(undefined, nextDevice.deviceId);
    } else {
      const newMode = facingMode === 'environment' ? 'user' : 'environment';
      setFacingMode(newMode);
      startCamera(newMode);
    }
  };

  // Nút chạm để phát video (User Gesture dành cho Safari / Chrome khi bị block autoplay)
  const handleUserTapToPlay = () => {
    if (videoRef.current) {
      playVideoSafely(videoRef.current);
    }
  };

  // Quản lý vòng đời modal
  useEffect(() => {
    if (isOpen) {
      setCapturedPhoto(null);
      setDetectedCode(null);
      setCameraError(null);
      setInAppNotice(false);
      isHandlingDetectionRef.current = false;
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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

        {/* Cảnh báo trình duyệt trong ứng dụng Zalo / Facebook */}
        {inAppNotice && (
          <div style={{ fontSize: '0.75rem', background: '#3b2505', color: '#fed7aa', padding: '6px 10px', borderRadius: 'var(--radius-sm)' }}>
            ⚠️ Bạn đang mở trong ứng dụng khác. Nếu camera bị đen, hãy bấm menu (⋮) chọn <strong>Mở bằng trình duyệt ngoài (Safari/Chrome)</strong>.
          </div>
        )}

        {/* Khung hình đối chiếu sau khi quét thành công */}
        {detectedCode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleRescan}>
                Quét lại
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirmDetected}>
                Xác nhận mã
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Vùng hiển thị Camera: Không dùng flex để tránh bug đen màn hình trên Safari iOS */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 290,
                backgroundColor: '#050810',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}
            >
              {/* Thẻ Video: Tuyệt đối, lấp đầy khung hiển thị */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    playVideoSafely(videoRef.current);
                  }
                }}
                onCanPlay={() => {
                  if (videoRef.current) {
                    playVideoSafely(videoRef.current);
                  }
                }}
                onPlaying={() => {
                  setIsLoadingCamera(false);
                  setNeedsTapToPlay(false);
                  setCameraActive(true);
                  startScanningLoop();
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                  backgroundColor: '#000',
                }}
              />

              {/* Lớp phủ Trạng thái Đang kết nối camera */}
              {isLoadingCamera && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(5, 8, 16, 0.88)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: '0.85rem',
                    gap: 10,
                    zIndex: 5,
                  }}
                >
                  <div style={{ width: 30, height: 30, border: '3px solid rgba(255,255,255,0.25)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  <span>Đang kết nối camera...</span>
                  <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)' }}>Vui lòng bấm &ldquo;Cho phép&rdquo; nếu máy hỏi quyền</span>
                </div>
              )}

              {/* Nút bấm cứu cánh khi trình duyệt chặn Autoplay (Yêu cầu User Gesture) */}
              {needsTapToPlay && !isLoadingCamera && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(5, 8, 16, 0.75)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    zIndex: 7,
                    padding: 16,
                    textAlign: 'center',
                  }}
                >
                  <span style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>Trình duyệt cần bạn chạm để bật khung hình camera:</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '10px 20px', fontSize: '0.9rem', fontWeight: 600 }}
                    onClick={handleUserTapToPlay}
                  >
                    ▶ Chạm để mở Camera
                  </button>
                </div>
              )}

              {/* Viewfinder Khung ngắm quét mã khi Camera đã phát hình */}
              {cameraActive && !isLoadingCamera && !needsTapToPlay && (
                <div
                  style={{
                    position: 'absolute',
                    top: '18%',
                    left: '10%',
                    width: '80%',
                    height: '64%',
                    border: '2px solid #3b82f6',
                    borderRadius: 12,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
                    pointerEvents: 'none',
                    zIndex: 4,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: 0,
                      right: 0,
                      height: 2,
                      background: 'rgba(59, 130, 246, 0.75)',
                      boxShadow: '0 0 8px #3b82f6',
                      transform: 'translateY(-50%)',
                    }}
                  />
                </div>
              )}

              {/* Thông báo lỗi & nút dự phòng khi camera không thể mở */}
              {cameraError && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    padding: 16,
                    textAlign: 'center',
                    color: '#fca5a5',
                    fontSize: '0.85rem',
                    background: 'rgba(15, 23, 42, 0.95)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    zIndex: 8,
                  }}
                >
                  <div>{cameraError}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                      onClick={() => startCamera()}
                    >
                      🔄 Thử lại
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: '0.8rem', padding: '6px 12px' }}
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
              {/* Nút chụp ảnh bằng máy ảnh gốc điện thoại: 100% không bao giờ lỗi màn hình đen */}
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 2, fontSize: '0.85rem', padding: '9px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onClick={() => fileInputRef.current?.click()}
              >
                <span>📷</span>
                <span>Chụp ảnh bằng máy (Khuyên dùng)</span>
              </button>

              {(availableDevices.length > 1 || true) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1, fontSize: '0.85rem', padding: '9px 10px' }}
                  onClick={handleCycleCamera}
                  title="Đổi camera trước / sau hoặc ống kính khác"
                >
                  🔄 Đổi cam
                </button>
              )}

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
