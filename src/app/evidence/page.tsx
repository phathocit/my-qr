'use client';

import React, { useEffect, useState } from 'react';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

export default function EvidencePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<
    Array<{
      id: string;
      entity_type: string;
      entity_id: string;
      device_id?: string | null;
      storage_key: string;
      created_at: string;
      signed_url?: string;
    }>
  >([]);
  const [queryInfo, setQueryInfo] = useState<{
    entity_type?: string;
    entity_id?: string;
    device_id?: string;
  }>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    async function loadEvidence() {
      try {
        setLoading(true);
        const searchParams = new URLSearchParams(window.location.search);
        const entityType = searchParams.get('entity_type') || undefined;
        const entityId = searchParams.get('entity_id') || undefined;
        const deviceId = searchParams.get('device_id') || undefined;

        setQueryInfo({ entity_type: entityType, entity_id: entityId, device_id: deviceId });

        if (!entityId && !deviceId) {
          setError('Không có thông tin hồ sơ hoặc thiết bị cần xem bằng chứng.');
          setLoading(false);
          return;
        }

        if (!isSupabaseConfigured()) {
          setError('Hệ thống đang hoạt động ở chế độ Mock cục bộ.');
          setLoading(false);
          return;
        }

        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setError('Yêu cầu đăng nhập tài khoản quản trị để xem ảnh chứng từ an toàn.');
          setLoading(false);
          return;
        }

        // Query evidence_photos
        let query = supabase.from('evidence_photos').select('*');
        if (entityType && entityId) {
          query = query.eq('entity_type', entityType).eq('entity_id', entityId);
        } else if (entityId) {
          query = query.eq('entity_id', entityId);
        } else if (deviceId) {
          query = query.eq('device_id', deviceId);
        }

        const { data: photoRows, error: fetchErr } = await query.order('created_at', { ascending: false });

        if (fetchErr) throw fetchErr;

        if (!photoRows || photoRows.length === 0) {
          setPhotos([]);
          setLoading(false);
          return;
        }

        // Tạo signed URL tạm thời 15 phút cho từng ảnh từ bucket private
        const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'evidence-photos';
        const withUrls = await Promise.all(
          photoRows.map(async (p: any) => {
            if (p.storage_key.startsWith('http://') || p.storage_key.startsWith('https://') || p.storage_key.startsWith('data:image')) {
              return { ...p, signed_url: p.storage_key };
            }
            const { data: signData } = await supabase.storage
              .from(bucket)
              .createSignedUrl(p.storage_key, 900); // 15 phút
            return {
              ...p,
              signed_url: signData?.signedUrl || null,
            };
          })
        );

        setPhotos(withUrls);
      } catch (err: any) {
        setError(err?.message || 'Lỗi khi tải bằng chứng ảnh.');
      } finally {
        setLoading(false);
      }
    }

    loadEvidence();
  }, []);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700 }}>Bằng chứng ảnh chứng từ</h2>
          <div style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 4 }}>
            {queryInfo.entity_type && <span>Sự kiện: <strong>{queryInfo.entity_type}</strong> | </span>}
            {queryInfo.entity_id && <span>Mã hồ sơ: <strong>{queryInfo.entity_id}</strong> | </span>}
            {queryInfo.device_id && <span>Thiết bị: <strong>{queryInfo.device_id}</strong></span>}
          </div>
        </div>
        <button
          onClick={() => window.history.back()}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: '#ffffff',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 500,
          }}
        >
          ← Quay lại
        </button>
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Đang xác thực và tải ảnh chứng từ bảo mật...
        </div>
      )}

      {error && (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            fontSize: '0.9rem',
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {!loading && !error && photos.length === 0 && (
        <div
          style={{
            padding: 36,
            textAlign: 'center',
            background: '#f9fafb',
            borderRadius: 8,
            border: '1px dashed #d1d5db',
            color: '#6b7280',
          }}
        >
          Không tìm thấy ảnh chứng từ nào cho sự kiện / thiết bị này.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {photos.map((photo) => (
          <div
            key={photo.id}
            style={{
              background: '#ffffff',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div
              style={{
                width: '100%',
                height: 220,
                background: '#111827',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              onClick={() => photo.signed_url && setPreviewUrl(photo.signed_url)}
            >
              {photo.signed_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.signed_url}
                  alt={photo.entity_type}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Không thể tải ảnh</span>
              )}
            </div>
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>
                Loại: {photo.entity_type}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
                Thời gian: {new Date(photo.created_at).toLocaleString('vi-VN')}
              </div>
              {photo.signed_url && (
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setPreviewUrl(photo.signed_url!)}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.75rem',
                      borderRadius: 4,
                      border: '1px solid #3b82f6',
                      background: '#eff6ff',
                      color: '#1d4ed8',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Phóng to ↗
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Preview"
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }}
          />
        </div>
      )}
    </div>
  );
}
