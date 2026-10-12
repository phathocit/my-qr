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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCapturedPhoto(null);
      setDetectedCode(null);
      setCameraError(null);
      return;
    }

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Trình duyệt không hỗ trợ truy cập camera hoặc đang chạy HTTP.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraActive(true);
        startScanningLoop();
      }
    } catch (err: any) {
      console.warn('Camera access denied or failed:', err);
      setCameraError('Không thể mở camera (vui lòng cấp quyền camera hoặc nhập mã thủ công).');
    }
  };

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
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

  const startScanningLoop = () => {
    // Check if BarcodeDetector is available natively
    const BarcodeDetectorClass = (window as any).BarcodeDetector;
    if (!BarcodeDetectorClass) {
      return; // Fallback to manual entry / photo capture
    }

    try {
      const barcodeDetector = new BarcodeDetectorClass({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'],
      });

      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const barcodes = await barcodeDetector.detect(videoRef.current);
          if (barcodes.length > 0) {
            const raw = barcodes[0].rawValue;
            if (raw) {
              const photo = captureFrame();
              stopCamera();
              setDetectedCode(raw);
              if (photo) setCapturedPhoto(photo);
            }
          }
        } catch {
          // Ignore frame decode errors
        }
      }, 400);
    } catch {
      // Ignored
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
    startCamera();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{title}</h3>
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

        {/* Viewfinder or Preview */}
        {detectedCode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="toast-notice info">
              <span>Đã quét được mã: <strong>{detectedCode}</strong></span>
            </div>
            {capturedPhoto && (
              <div style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={capturedPhoto} alt="Captured frame" style={{ width: '100%', height: 'auto', display: 'block' }} />
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
                height: 240,
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
                    width: '70%',
                    height: '50%',
                    border: '2px solid rgba(59, 130, 246, 0.8)',
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
                📸 Chụp ảnh tem đối chiếu
              </button>
            )}
          </div>
        )}

        {/* Manual Input Fallback */}
        {allowManual && (
          <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
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
