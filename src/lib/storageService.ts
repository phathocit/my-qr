import { createClient, isSupabaseConfigured } from './supabase/client';

export interface UploadPhotoParams {
  fileOrDataUrl: File | string;
  entityType: 'INBOUND_RECEIPT' | 'OUTBOUND_RECEIPT' | 'ASSIGNMENT' | 'WARRANTY_INTAKE' | 'WARRANTY_TRANSFER' | 'WARRANTY_RETURN' | 'WARRANTY_DELIVERY' | 'DEVICE_SN_LABEL';
  entityId: string;
  deviceId?: string;
  performer?: string;
}

export class StorageService {
  private bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'evidence-photos';

  // Client-side image compression: keeps SN sharp, max dimension 1600px, JPEG 0.82
  async compressImage(fileOrDataUrl: File | string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const maxDim = 1600;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Blob conversion failed'));
          },
          'image/jpeg',
          0.82
        );
      };

      img.onerror = (err) => reject(err);

      if (typeof fileOrDataUrl === 'string') {
        img.src = fileOrDataUrl;
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          img.src = e.target?.result as string;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(fileOrDataUrl);
      }
    });
  }

  // Upload to Supabase Storage Private Bucket and save record in evidence_photos
  async uploadEvidencePhoto(params: UploadPhotoParams): Promise<{ success: boolean; storageKey: string; signedUrl?: string }> {
    const compressedBlob = await this.compressImage(params.fileOrDataUrl);

    if (!isSupabaseConfigured()) {
      // Mock mode: generate local data url
      const mockKey = `mock/${params.entityType}/${Date.now()}.jpg`;
      return {
        success: true,
        storageKey: mockKey,
        signedUrl: typeof params.fileOrDataUrl === 'string' ? params.fileOrDataUrl : URL.createObjectURL(compressedBlob),
      };
    }

    const supabase = createClient();
    const fileName = `${params.entityType.toLowerCase()}/${params.entityId}/${Date.now()}-${Math.random().toString(36).substring(2, 7)}.jpg`;

    // 1. Upload to Storage
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(this.bucket)
      .upload(fileName, compressedBlob, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadErr) throw uploadErr;

    const storageKey = uploadData.path;

    // 2. Insert record into evidence_photos với cơ chế rollback dọn dẹp file rác
    try {
      const { error: dbErr } = await supabase.from('evidence_photos').insert({
        entity_type: params.entityType,
        entity_id: params.entityId,
        device_id: params.deviceId || null,
        storage_key: storageKey,
        performer: params.performer || 'Admin',
        watermark_meta: {
          server_timestamp: new Date().toISOString(),
          entity_type: params.entityType,
          entity_id: params.entityId,
        },
      });

      if (dbErr) {
        // Rollback: Xóa file khỏi storage nếu lưu record thất bại để tránh file mồ côi
        await supabase.storage.from(this.bucket).remove([storageKey]).catch(() => {});
        throw new Error(`Lỗi lưu dữ liệu ảnh bằng chứng: ${dbErr.message}`);
      }
    } catch (err) {
      await supabase.storage.from(this.bucket).remove([storageKey]).catch(() => {});
      throw err;
    }

    // 3. Generate 1-hour signed URL for secure viewing
    const { data: signedData } = await supabase.storage
      .from(this.bucket)
      .createSignedUrl(storageKey, 3600);

    return {
      success: true,
      storageKey,
      signedUrl: signedData?.signedUrl,
    };
  }

  // Dọn dẹp file rác khỏi storage khi các bước nghiệp vụ kế tiếp bị thất bại
  async cleanupOrphanedUpload(storageKey: string): Promise<void> {
    if (!isSupabaseConfigured() || storageKey.startsWith('mock/')) return;
    const supabase = createClient();
    try {
      await supabase.storage.from(this.bucket).remove([storageKey]);
    } catch (err) {
      console.warn('Cảnh báo: Không thể dọn dẹp file storage:', storageKey, err);
    }
  }

  // Get signed URL for an existing storage key
  async getSignedUrl(storageKey: string, expiresIn = 3600): Promise<string | null> {
    if (!isSupabaseConfigured() || storageKey.startsWith('mock/')) {
      return storageKey;
    }
    const supabase = createClient();
    const { data } = await supabase.storage
      .from(this.bucket)
      .createSignedUrl(storageKey, expiresIn);
    return data?.signedUrl || null;
  }
}

export const storageService = new StorageService();
