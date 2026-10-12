'use client';

import React, { useState, useRef, useEffect } from 'react';

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
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [detectedCode, setDetectedCode] = useState<string | null>(null);
  const [engineUsed, setEngineUsed] = useState<'Native BarcodeDetector' | 'ZXing Client Library' | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const zxingReaderRef = useRef<any>(null);
  const isHandlingDetectionRef = useRef(false);

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

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    setCameraError(null);
    isHandlingDetectionRef.current = false;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Trình duyệt không hỗ trợ Web Camera hoặc đang chạy giao thức không an toàn (cần HTTPS).');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        startScanningLoop();
      }
    } catch (err: any) {
      console.warn('Camera access denied or failed:', err);
      setCameraError('Không thể mở camera. Vui lòng cấp quyền truy cập hoặc nhập mã thủ công.');
    }
  };

  const stopCamera = () => {
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
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const captureFrame = (): string | null => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  const onCodeFound = (code: string) => {
    if (isHandlingDetectionRef.current) return;
    isHandlingDetectionRef.current = true;

    // Freeze camera and capture current frame
    const photo = captureFrame();
    stopCamera();

    setDetectedCode(code.trim());
    if (photo) setCapturedPhoto(photo);
  };

  const startScanningLoop = async () => {
    const BarcodeDetectorClass = (window as any).BarcodeDetector;

    // 1. Check if Native BarcodeDetector is available
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
        setEngineUsed('Native BarcodeDetector');

        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2 || isHandlingDetectionRef.current) return;
          try {
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              onCodeFound(barcodes[0].rawValue);
            }
          } catch {}
        }, 300);
        return;
      } catch (e) {
        console.warn('Native BarcodeDetector initialization failed, falling back to ZXing', e);
      }
    }

    // 2. Client-side Fallback using @zxing/library (loaded dynamically on-demand)
    try {
      setEngineUsed('ZXing Client Library');
      const { BrowserMultiFormatReader } = await import('@zxing/library');
      const reader = new BrowserMultiFormatReader();
      zxingReaderRef.current = reader;

      if (!videoRef.current) return;

      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2 || isHandlingDetectionRef.current) return;
        try {
          const result = await reader.decodeFromVideoElement(videoRef.current);
          if (result) {
            const text = result.getText();
            if (text) {
              onCodeFound(text);
            }
          }
        } catch {
          // Frame without barcode - ignored
        }
      }, 350);
    } catch (err) {
      console.warn('Failed to load @zxing/library scanner fallback', err);
    }
  };

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
                Bộ giải mã: {engineUsed}
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

        {/* Viewfinder or Frozen Frame Preview */}
        {detectedCode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="toast-notice info">
              <span>Đã quét được mã: <strong>{detectedCode}</strong></span>
            </div>
            {capturedPhoto && (
              <div style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '2px solid var(--primary)', position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={capturedPhoto} alt="Captured frame" style={{ width: '100%', height: 'auto', display: 'block' }} />
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
                height: 250,
                background: '#000',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: cameraActive ? 'block' : 'none',
                }}
              />

              {/* Viewfinder Target Box */}
              {cameraActive && (
                <div
                  style={{
                    position: 'absolute',
                    width: '75%',
                    height: '55%',
                    border: '2px solid rgba(59, 130, 246, 0.85)',
                    borderRadius: 8,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
                    pointerEvents: 'none',
                  }}
                />
              )}

              {cameraError && (
                <div style={{ padding: 16, textAlign: 'center', color: '#fca5a5', fontSize: '0.85rem' }}>
                  {cameraError}
                </div>
              )}
            </div>

            {/* Quick manual capture button */}
            {cameraActive && (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  const photo = captureFrame();
                  if (photo) setCapturedPhoto(photo);
                }}
              >
                📸 Chụp lại ảnh tem đối chiếu
              </button>
            )}
          </div>
        )}

        {/* Manual Input Fallback */}
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
