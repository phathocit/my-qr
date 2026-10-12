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
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [detectedCode, setDetectedCode] = useState<string | null>(null);
  const [engineUsed, setEngineUsed] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const zxingReaderRef = useRef<any>(null);
  const isHandlingDetectionRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Dừng camera
  const stopCamera = useCallback(() => {
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
  }, []);

  // Chụp khung hình hiện tại từ video element
  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }, []);

  // Khi tìm thấy mã hợp lệ
  const onCodeFound = useCallback((code: string, customPhoto?: string) => {
    if (isHandlingDetectionRef.current) return;
    isHandlingDetectionRef.current = true;

    const trimmed = code.trim();
    if (!trimmed) return;

    // Đóng băng khung hình camera để đối chiếu
    const photo = customPhoto || captureFrame();
    stopCamera();

    setDetectedCode(trimmed);
    if (photo) setCapturedPhoto(photo);
  }, [captureFrame, stopCamera]);

  // Vòng lặp giải mã Barcode/QR
  const startScanningLoop = useCallback(async () => {
    const BarcodeDetectorClass = (window as any).BarcodeDetector;

    // 1. Thử dùng BarcodeDetector phần cứng trình duyệt
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
        console.warn('Native BarcodeDetector init failed, fallback to ZXing', e);
      }
    }

    // 2. Dự phòng client-side bằng @zxing/library
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
          // Frame chưa có barcode - bỏ qua
        }
      }, 300);
    } catch (err) {
      console.warn('Failed to load @zxing/library', err);
    }
  }, [onCodeFound]);

  // Khởi động Camera với cơ chế chống màn hình đen
  const startCamera = useCallback(async (mode: 'environment' | 'user' = facingMode) => {
    stopCamera();
    setCameraError(null);
    setIsLoadingCamera(true);
    isHandlingDetectionRef.current = false;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Trình duyệt không hỗ trợ Web Camera hoặc trang web chưa được bảo vệ bằng HTTPS.');
      setIsLoadingCamera(false);
      return;
    }

    // Kiểm tra số lượng camera
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      setHasMultipleCameras(videoDevices.length > 1);
    } catch {}

    // Cấu hình constraints thích ứng
    const constraintsList: MediaStreamConstraints[] = [
      // 1. Thử camera sau với độ phân giải linh hoạt
      {
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
        audio: false,
      },
      // 2. Dự phòng: chỉ chỉ định facingMode
      {
        video: { facingMode: mode },
        audio: false,
      },
      // 3. Dự phòng tối thượng: bật bất kỳ video stream nào có sẵn
      {
        video: true,
        audio: false,
      },
    ];

    let stream: MediaStream | null = null;
    let lastError: any = null;

    for (const constraint of constraintsList) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraint);
        if (stream) break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!stream) {
      console.warn('Tất cả cấu hình camera đều thất bại:', lastError);
      setCameraError(
        lastError?.name === 'NotAllowedError'
          ? 'Quyền truy cập camera bị từ chối. Vui lòng cho phép quyền camera trong cài đặt trình duyệt.'
          : 'Không thể kích hoạt camera. Bạn có thể bấm "Chụp ảnh từ Camera máy" hoặc nhập mã thủ công.'
      );
      setIsLoadingCamera(false);
      return;
    }

    streamRef.current = stream;

    // Gán vào thẻ video và đợi sự kiện play
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      video.muted = true;

      // Hàm kích hoạt phát video an toàn (xử lý cả iOS Safari & Android Chrome)
      const playVideo = async () => {
        try {
          await video.play();
          setCameraActive(true);
          setIsLoadingCamera(false);
          startScanningLoop();
        } catch (playErr) {
          console.warn('Lỗi video.play(), thử lại lần 2:', playErr);
          try {
            video.muted = true;
            await video.play();
            setCameraActive(true);
            setIsLoadingCamera(false);
            startScanningLoop();
          } catch {
            setCameraError('Trình duyệt chặn tự động phát luồng video.');
            setIsLoadingCamera(false);
          }
        }
      };

      if (video.readyState >= 2) {
        await playVideo();
      } else {
        video.onloadedmetadata = () => {
          playVideo();
        };
        video.oncanplay = () => {
          if (!cameraActive) playVideo();
        };
      }
    }
  }, [facingMode, startScanningLoop, stopCamera, cameraActive]);

  // Quét Barcode từ File ảnh (Tải lên hoặc Chụp bằng Camera hệ điều hành)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingCamera(true);
    setCameraError(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target?.result as string;
      if (!dataUrl) {
        setIsLoadingCamera(false);
        return;
      }

      const img = new Image();
      img.onload = async () => {
        let foundCode: string | null = null;

        // 1. Thử bằng Native BarcodeDetector
        const BarcodeDetectorClass = (window as any).BarcodeDetector;
        if (BarcodeDetectorClass) {
          try {
            const detector = new BarcodeDetectorClass();
            const codes = await detector.detect(img);
            if (codes.length > 0 && codes[0].rawValue) {
              foundCode = codes[0].rawValue;
            }
          } catch {}
        }

        // 2. Thử bằng ZXing
        if (!foundCode) {
          try {
            const { BrowserMultiFormatReader } = await import('@zxing/library');
            const zxReader = new BrowserMultiFormatReader();
            const res = await zxReader.decodeFromImageUrl(dataUrl);
            if (res && res.getText()) {
              foundCode = res.getText();
            }
          } catch {}
        }

        setIsLoadingCamera(false);

        if (foundCode) {
          onCodeFound(foundCode, dataUrl);
        } else {
          setCameraError('Không tìm thấy mã vạch trong ảnh đã chụp. Bạn có thể chụp lại góc gần và rõ nét hơn.');
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Đổi camera trước / sau
  const handleToggleCamera = () => {
    const newMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newMode);
    startCamera(newMode);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCapturedPhoto(null);
      setDetectedCode(null);
      setCameraError(null);
      setEngineUsed(null);
      isHandlingDetectionRef.current = false;
      return;
    }

    startCamera('environment');

    return () => {
      stopCamera();
    };
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
    startCamera(facingMode);
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

        {/* Viewfinder hoặc Khung hình đối chiếu đã đóng băng */}
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
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 260,
                background: '#090d16',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Thẻ Video: Luôn render trong DOM, có đầy đủ thuộc tính cho Safari iOS */}
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

              {/* Lớp phủ Trạng thái Loading hoặc Lỗi */}
              {isLoadingCamera && (
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
                    fontSize: '0.85rem',
                    gap: 8,
                    zIndex: 5,
                  }}
                >
                  <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.3)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  <span>Đang kết nối camera...</span>
                </div>
              )}

              {/* Viewfinder Target Box khi Camera đang hoạt động */}
              {cameraActive && !isLoadingCamera && (
                <div
                  style={{
                    position: 'absolute',
                    width: '78%',
                    height: '58%',
                    border: '2px solid #3b82f6',
                    borderRadius: 10,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
                    pointerEvents: 'none',
                    zIndex: 4,
                  }}
                >
                  <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 2, background: 'rgba(59, 130, 246, 0.6)', transform: 'translateY(-50%)' }} />
                </div>
              )}

              {cameraError && (
                <div style={{ position: 'absolute', inset: 0, padding: 16, textAlign: 'center', color: '#fca5a5', fontSize: '0.85rem', background: 'rgba(15, 23, 42, 0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 6 }}>
                  <div>{cameraError}</div>
                  <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }} onClick={() => startCamera(facingMode)}>
                    🔄 Thử lại Camera
                  </button>
                </div>
              )}
            </div>

            {/* Các tùy chọn điều khiển Camera */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {hasMultipleCameras && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1, fontSize: '0.8rem', padding: '8px 10px' }}
                  onClick={handleToggleCamera}
                >
                  🔄 Đổi Camera ({facingMode === 'environment' ? 'Sau' : 'Trước'})
                </button>
              )}

              {/* Nút chụp ảnh từ app Camera hệ thống hoặc Thư viện (Dự phòng tối thượng chống màn hình đen) */}
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1, fontSize: '0.8rem', padding: '8px 10px' }}
                onClick={() => fileInputRef.current?.click()}
              >
                📷 Chụp ảnh bằng máy
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
            <div className="form-label">Nhập SN / Mã quản lý thủ công:</div>
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
