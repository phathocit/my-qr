'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats, type CameraDevice } from 'html5-qrcode';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (code: string, photoDataUrl?: string) => void;
  title?: string;
  allowManual?: boolean;
}

const CONTAINER_ID = 'qr-code-scanner-region';

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
  const [detectedCode, setDetectedCode] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [availableCameras, setAvailableCameras] = useState<CameraDevice[]>([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState<number>(0);
  const [inAppNotice, setInAppNotice] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isHandlingDetectionRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ─── Dừng camera một cách an toàn ─────────────────────────────────────────
  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
        scanner.clear();
      } catch (err) {
        console.warn('Lỗi khi dừng scanner:', err);
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
    setIsLoadingCamera(false);
  }, []);

  // ─── Xử lý khi quét trúng mã ─────────────────────────────────────────────
  const onCodeFound = useCallback(
    async (code: string, photoDataUrl?: string) => {
      if (isHandlingDetectionRef.current) return;
      isHandlingDetectionRef.current = true;

      const trimmed = code.trim();
      if (!trimmed) {
        isHandlingDetectionRef.current = false;
        return;
      }

      // Thử lấy khung hình video đối chiếu nếu có
      let photo = photoDataUrl;
      if (!photo) {
        try {
          const videoEl = document.querySelector<HTMLVideoElement>(`#${CONTAINER_ID} video`);
          if (videoEl && videoEl.videoWidth > 0) {
            const canvas = document.createElement('canvas');
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
              photo = canvas.toDataURL('image/jpeg', 0.85);
            }
          }
        } catch {}
      }

      await stopScanner();
      setDetectedCode(trimmed);
      if (photo) setCapturedPhoto(photo);
    },
    [stopScanner]
  );

  // ─── Khởi động camera với Html5Qrcode ────────────────────────────────────
  const startScanner = useCallback(
    async (specificDeviceId?: string) => {
      await stopScanner();

      setCameraError(null);
      setIsLoadingCamera(true);
      setCameraActive(false);
      isHandlingDetectionRef.current = false;

      // Kiểm tra môi trường HTTPS
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

      // Đảm bảo DOM element tồn tại
      const containerEl = document.getElementById(CONTAINER_ID);
      if (!containerEl) {
        setIsLoadingCamera(false);
        return;
      }

      try {
        const scanner = new Html5Qrcode(CONTAINER_ID, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF,
          ],
          verbose: false,
        });
        scannerRef.current = scanner;

        // Lấy danh sách camera khả dụng
        try {
          const cameras = await Html5Qrcode.getCameras();
          if (cameras && cameras.length > 0) {
            setAvailableCameras(cameras);
          }
        } catch {}

        // Cấu hình camera
        const cameraConfig = specificDeviceId
          ? { deviceId: { exact: specificDeviceId } }
          : { facingMode: 'environment' };

        // Cấu hình khung quét
        const scanConfig = {
          fps: 12,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const boxWidth = Math.floor(minEdge * 0.85);
            // Dạng hình chữ nhật ngang vừa cho Barcode lẫn QR
            return {
              width: Math.max(220, boxWidth),
              height: Math.max(160, Math.floor(boxWidth * 0.7)),
            };
          },
          aspectRatio: 1.333333,
        };

        await scanner.start(
          cameraConfig,
          scanConfig,
          (decodedText) => {
            onCodeFound(decodedText);
          },
          () => {
            // Callback gọi mỗi frame không có mã - bỏ qua
          }
        );

        setIsLoadingCamera(false);
        setCameraActive(true);
      } catch (err: any) {
        console.error('Html5Qrcode start error:', err);
        setIsLoadingCamera(false);
        setCameraActive(false);

        const errMsg = String(err?.message || err);
        if (/permission/i.test(errMsg) || /notallowed/i.test(errMsg)) {
          setCameraError('Quyền Camera bị từ chối. Hãy cho phép Camera trong Cài đặt hoặc bấm "📷 Chụp ảnh bằng máy".');
        } else if (/notfound/i.test(errMsg) || /no device/i.test(errMsg)) {
          setCameraError('Không tìm thấy camera khả dụng trên thiết bị này.');
        } else {
          setCameraError('Không thể mở camera. Vui lòng bấm "📷 Chụp ảnh bằng máy" bên dưới hoặc nhập thủ công.');
        }
      }
    },
    [stopScanner, onCodeFound]
  );

  // ─── Đổi camera (Chuyển giữa các ống kính hoặc trước/sau) ─────────────────
  const handleCycleCamera = () => {
    if (availableCameras.length > 1) {
      const nextIndex = (currentCameraIndex + 1) % availableCameras.length;
      setCurrentCameraIndex(nextIndex);
      startScanner(availableCameras[nextIndex].id);
    } else {
      startScanner();
    }
  };

  // ─── Quét bằng ảnh chụp từ camera gốc điện thoại ─────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingCamera(true);
    setCameraError(null);

    try {
      // Đọc preview hình ảnh
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const photoDataUrl = evt.target?.result as string;

        try {
          // Tạo một instance quét tạm thời cho file
          let fileScanner = scannerRef.current;
          let needCleanup = false;
          if (!fileScanner) {
            fileScanner = new Html5Qrcode(CONTAINER_ID, { verbose: false });
            needCleanup = true;
          }

          const decodedText = await fileScanner.scanFile(file, false);
          if (needCleanup) fileScanner.clear();

          setIsLoadingCamera(false);
          if (decodedText) {
            onCodeFound(decodedText, photoDataUrl);
          } else {
            setCameraError('Không tìm thấy mã vạch trong ảnh chụp. Hãy chụp lại gần hơn và rõ nét.');
          }
        } catch (scanErr) {
          console.warn('Lỗi quét file:', scanErr);
          setIsLoadingCamera(false);
          setCameraError('Không nhận diện được mã vạch trong ảnh. Hãy chụp lại ở cự ly gần và đủ sáng.');
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
    let timer: NodeJS.Timeout | null = null;
    if (isOpen) {
      setCapturedPhoto(null);
      setDetectedCode(null);
      setCameraError(null);
      setInAppNotice(false);
      isHandlingDetectionRef.current = false;

      // Chờ 200ms để modal DOM render hoàn tất rồi khởi động camera
      timer = setTimeout(() => {
        startScanner();
      }, 200);
    } else {
      stopScanner();
    }

    return () => {
      if (timer) clearTimeout(timer);
      stopScanner();
    };
  }, [isOpen, startScanner, stopScanner]);

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
    startScanner();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{title}</h3>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Động cơ: Html5Qrcode Pro {cameraActive ? '● Đang quét...' : ''}
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
            ⚠️ Đang mở trong ứng dụng khác. Nếu camera bị đen, hãy bấm menu ⋮ → <strong>Mở bằng Chrome / Safari</strong>.
          </div>
        )}

        {/* Kết quả nhận diện */}
        {detectedCode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <div className="toast-notice info">
              <span>
                Đã nhận diện: <strong>{detectedCode}</strong>
              </span>
            </div>
            {capturedPhoto && (
              <div
                style={{
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  border: '2px solid var(--primary)',
                  position: 'relative',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={capturedPhoto}
                  alt="Khung hình đối chiếu"
                  style={{ width: '100%', height: 'auto', display: 'block' }}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: 6,
                    right: 6,
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    fontSize: '0.7rem',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  Khung hình đối chiếu
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleRescan}>
                Quét lại
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirmDetected}>
                ✓ Xác nhận mã
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
            {/* Vùng chứa camera Scanner */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                minHeight: 280,
                background: '#090d16',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Target div cho Html5Qrcode */}
              <div
                id={CONTAINER_ID}
                style={{
                  width: '100%',
                  height: '100%',
                  minHeight: 280,
                }}
              />

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
                      onClick={() => startScanner()}
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
                🔄 Đổi cam {availableCameras.length > 1 ? `(${currentCameraIndex + 1}/${availableCameras.length})` : ''}
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
          <form
            onSubmit={handleManualSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}
          >
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
