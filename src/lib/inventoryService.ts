import { createClient, isSupabaseConfigured } from './supabase/client';
import { Device, Product, Party, InboundReceipt, OutboundReceipt, Assignment, WarrantyCase } from '@/types/database';

// Sample Seed Data for Mock Mode
const INITIAL_PRODUCTS: Product[] = [
  { id: 'p-1', name: 'ThinkPad T14 Gen 3', brand: 'Lenovo', category: 'Laptop', created_at: new Date().toISOString() },
  { id: 'p-2', name: 'Dell Latitude 5430', brand: 'Dell', category: 'Laptop', created_at: new Date().toISOString() },
  { id: 'p-3', name: 'Dell UltraSharp U2422H', brand: 'Dell', category: 'Màn hình', created_at: new Date().toISOString() },
  { id: 'p-4', name: 'Chuột Logitech MX Master 3S', brand: 'Logitech', category: 'Phụ kiện', created_at: new Date().toISOString() },
];

const INITIAL_PARTIES: Party[] = [
  { id: 'pt-1', name: 'Synnex FPT Distribution', type: 'SUPPLIER', phone: '02473006666', created_at: new Date().toISOString() },
  { id: 'pt-2', name: 'Digiworld (DGW)', type: 'SUPPLIER', phone: '02839290059', created_at: new Date().toISOString() },
  { id: 'pt-3', name: 'Công ty CP Tin Học Mai Hoàng', type: 'SUPPLIER', phone: '02435377109', created_at: new Date().toISOString() },
  { id: 'pt-long', name: 'Nguyễn Hoàng Long (IT Nội bộ)', type: 'INTERNAL_MEMBER', phone: '0988776655', created_at: new Date().toISOString() },
  { id: 'pt-4', name: 'Công ty Test Đối Tác', type: 'CUSTOMER_ORG', phone: '0901234567', created_at: new Date().toISOString() },
];

const INITIAL_DEVICES: Device[] = [
  {
    id: 'd-1',
    product_id: 'p-1',
    product: INITIAL_PRODUCTS[0],
    management_code: 'DEV-202610-001',
    serial_number: 'PF3X90A1',
    owner_type: 'INTERNAL',
    holder_type: 'INTERNAL_STORAGE',
    technical_condition: 'USABLE',
    lifecycle: 'ACTIVE',
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: new Date().toISOString(),
    supplier_warranty: {
      id: 'w-1',
      device_id: 'd-1',
      policy_type: 'SUPPLIER_POLICY',
      source_event_type: 'INBOUND',
      source_event_id: 'rec-1',
      has_warranty: true,
      start_date: '2026-01-01',
      end_date: '2028-01-01',
      terms_note: 'Bảo hành chính hãng Lenovo 36 tháng',
      created_at: new Date().toISOString(),
    },
  },
  {
    id: 'd-dev-tp-04',
    product_id: 'p-1',
    product: INITIAL_PRODUCTS[0],
    management_code: 'DEV-TP-04',
    serial_number: 'PF-3A9804',
    owner_type: 'INTERNAL',
    holder_type: 'EXTERNAL_PARTY',
    holder_party_id: 'pt-long',
    holder_party: { id: 'pt-long', name: 'Nguyễn Hoàng Long (IT Nội bộ)', type: 'INTERNAL_MEMBER', created_at: new Date().toISOString() },
    technical_condition: 'USABLE',
    lifecycle: 'ACTIVE',
    active_assignment: {
      id: 'asg-loan-long',
      device_id: 'd-dev-tp-04',
      recipient_party_id: 'pt-long',
      recipient_party: { id: 'pt-long', name: 'Nguyễn Hoàng Long (IT Nội bộ)', type: 'INTERNAL_MEMBER', created_at: new Date().toISOString() },
      assignment_type: 'LOAN',
      checkout_date: '2026-10-10T00:00:00.000Z',
      expected_return_date: '2026-11-10',
      checkout_condition: 'USABLE',
      checkout_notes: 'Cấp máy ThinkPad làm dự án IT quý 4',
      created_at: '2026-10-10T00:00:00.000Z',
    },
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'd-2',
    product_id: 'p-2',
    product: INITIAL_PRODUCTS[1],
    management_code: 'DEV-202610-002',
    serial_number: '8XJ45Z2',
    owner_type: 'INTERNAL',
    holder_type: 'INTERNAL_STORAGE',
    technical_condition: 'NEEDS_INSPECTION',
    lifecycle: 'ACTIVE',
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

class InventoryService {
  private products: Product[] = INITIAL_PRODUCTS;
  private parties: Party[] = INITIAL_PARTIES;
  private devices: Device[] = INITIAL_DEVICES;
  private inboundReceipts: InboundReceipt[] = [];
  private outboundReceipts: OutboundReceipt[] = [];
  private assignments: Assignment[] = [];
  private warrantyCases: WarrantyCase[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      const savedDevices = localStorage.getItem('mock_devices');
      if (savedDevices) {
        try { this.devices = JSON.parse(savedDevices); } catch {}
      }
    }
  }

  private persistMock() {
    if (typeof window !== 'undefined') {
      localStorage.setItem('mock_devices', JSON.stringify(this.devices));
    }
  }

  public isUsingMock(): boolean {
    return !isSupabaseConfigured();
  }

  // --- QUERY APIS ---
  async getProducts(): Promise<Product[]> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { data, error } = await supabase.from('products').select('*').order('name');
      if (!error && data) return data;
    }
    return this.products;
  }

  async getParties(type?: string): Promise<Party[]> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      let query = supabase.from('parties').select('*').order('name');
      if (type) query = query.eq('type', type);
      const { data, error } = await query;
      if (!error && data) return data;
    }
    if (type) return this.parties.filter((p) => p.type === type);
    return this.parties;
  }

  resolvePhotoUrl(storageKey?: string | null): string | null {
    if (!storageKey) return null;
    if (storageKey.startsWith('http://') || storageKey.startsWith('https://') || storageKey.startsWith('data:')) {
      return storageKey;
    }
    const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'evidence-photos';
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ywpcfkrcmclcotvnelgy.supabase.co';
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${storageKey}`;
  }

  findSupplierForDevice(dev?: Device | null, parties?: Party[]): Party | null {
    if (!dev || !parties || parties.length === 0) return null;
    const suppliers = parties.filter((p) => p.type === 'SUPPLIER');
    if (suppliers.length === 0) return null;

    if (dev.inbound_receipt && (dev.inbound_receipt as any).supplier) {
      return (dev.inbound_receipt as any).supplier;
    }
    if (dev.holder_party_id) {
      const matchHolder = suppliers.find((s) => s.id === dev.holder_party_id);
      if (matchHolder) return matchHolder;
    }
    const terms = (dev.supplier_warranty?.terms_note || '').toLowerCase();
    if (terms) {
      const matchTerms = suppliers.find((s) => terms.includes(s.name.toLowerCase()));
      if (matchTerms) return matchTerms;
    }

    const brand = (dev.product?.brand || '').toLowerCase();
    const prodName = (dev.product?.name || '').toLowerCase();

    for (const s of suppliers) {
      const sNotes = (s.notes || '').toLowerCase();
      const sName = s.name.toLowerCase();
      if (brand && (sNotes.includes(brand) || sName.includes(brand))) {
        return s;
      }
    }

    if (brand.includes('lenovo') || prodName.includes('thinkpad')) {
      const s = suppliers.find((s) => s.name.toLowerCase().includes('fpt') || s.name.toLowerCase().includes('synnex'));
      if (s) return s;
    }
    if (brand.includes('dareu') || brand.includes('fl-esports') || prodName.includes('dareu') || prodName.includes('cmk')) {
      const s = suppliers.find((s) => s.name.toLowerCase().includes('mai hoàng'));
      if (s) return s;
    }
    if (brand.includes('dell') || prodName.includes('ultrasharp')) {
      const s = suppliers.find((s) => s.name.toLowerCase().includes('dgw') || s.name.toLowerCase().includes('digiworld'));
      if (s) return s;
    }

    return suppliers[0] || null;
  }

  async getDevices(): Promise<Device[]> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('devices')
        .select(`
          *,
          product:products(*),
          owner_party:parties!devices_owner_party_id_fkey(*),
          holder_party:parties!devices_holder_party_id_fkey(*),
          evidence_photos:evidence_photos(*),
          warranty_policies:warranty_policies(*),
          assignments:assignments(*, recipient_party:parties(*)),
          inbound_receipt:inbound_receipts(*, supplier:parties(*)),
          outbound_items:outbound_items(*, outbound_receipt:outbound_receipts(*, recipient:parties(*)))
        `)
        .order('created_at', { ascending: false });
      if (!error && data) {
        return (data as any[]).map((dev) => {
          if (dev.evidence_photos && dev.evidence_photos.length > 0) {
            const firstPhoto = dev.evidence_photos[0];
            const { data: pubUrl } = supabase.storage
              .from('evidence-photos')
              .getPublicUrl(firstPhoto.storage_key);
            dev.photo_url = pubUrl?.publicUrl || this.resolvePhotoUrl(firstPhoto.storage_key);
          }
          if (dev.warranty_policies && Array.isArray(dev.warranty_policies)) {
            dev.supplier_warranty = dev.warranty_policies.find((p: any) => p.policy_type === 'SUPPLIER_POLICY') || null;
            dev.customer_warranty = dev.warranty_policies.find((p: any) => p.policy_type === 'CUSTOMER_POLICY') || null;
          }
          if (dev.assignments && Array.isArray(dev.assignments)) {
            dev.active_assignment = dev.assignments.find((a: any) => !a.checkin_date) || null;
          }
          return this.enrichDeviceDates(dev);
        });
      }
    }
    return this.devices.map((d) => this.enrichDeviceDates(d));
  }

  enrichDeviceDates(dev: any): Device {
    // 1. Ngày nhập kho (Inbound / Import Date)
    dev.inbound_date = dev.inbound_receipt?.received_date || dev.inbound_receipt?.created_at || dev.created_at;

    // 2. Ngày xuất kho (Outbound / Export Date)
    let outDate: string | null = null;
    let outReceipt: OutboundReceipt | null = null;

    if (dev.outbound_items && Array.isArray(dev.outbound_items) && dev.outbound_items.length > 0) {
      const sortedOut = [...dev.outbound_items].sort((a: any, b: any) =>
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
      const topOut = sortedOut[0];
      outReceipt = topOut.outbound_receipt || null;
      outDate = outReceipt?.outbound_date || outReceipt?.created_at || topOut.created_at || null;
    }

    if (!outDate && dev.active_assignment?.checkout_date) {
      outDate = dev.active_assignment.checkout_date;
    }

    if (!outDate && dev.customer_warranty?.start_date && (dev.owner_type === 'EXTERNAL' || dev.holder_type === 'EXTERNAL_PARTY')) {
      outDate = dev.customer_warranty.start_date;
    }

    dev.outbound_date = outDate;
    dev.outbound_receipt = outReceipt;
    return dev as Device;
  }

  async findDeviceByCode(code: string): Promise<Device | null> {
    const trimmed = code.trim();
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('devices')
        .select(`
          *,
          product:products(*),
          owner_party:parties!devices_owner_party_id_fkey(*),
          holder_party:parties!devices_holder_party_id_fkey(*),
          evidence_photos:evidence_photos(*),
          warranty_policies:warranty_policies(*),
          assignments:assignments(*, recipient_party:parties(*)),
          inbound_receipt:inbound_receipts(*, supplier:parties(*)),
          outbound_items:outbound_items(*, outbound_receipt:outbound_receipts(*, recipient:parties(*)))
        `)
        .or(`management_code.eq.${trimmed},serial_number.eq.${trimmed}`)
        .single();
      if (!error && data) {
        const dev = data as any;
        if (dev.evidence_photos && dev.evidence_photos.length > 0) {
          const firstPhoto = dev.evidence_photos[0];
          const { data: pubUrl } = supabase.storage
            .from('evidence-photos')
            .getPublicUrl(firstPhoto.storage_key);
          dev.photo_url = pubUrl?.publicUrl || this.resolvePhotoUrl(firstPhoto.storage_key);
        }
        if (dev.warranty_policies && Array.isArray(dev.warranty_policies)) {
          dev.supplier_warranty = dev.warranty_policies.find((p: any) => p.policy_type === 'SUPPLIER_POLICY') || null;
          dev.customer_warranty = dev.warranty_policies.find((p: any) => p.policy_type === 'CUSTOMER_POLICY') || null;
        }
        if (dev.assignments && Array.isArray(dev.assignments)) {
          dev.active_assignment = dev.assignments.find((a: any) => !a.checkin_date) || null;
        }
        return this.enrichDeviceDates(dev);
      }
    }

    return (
      this.devices.find(
        (d) => d.management_code.toLowerCase() === trimmed.toLowerCase() ||
               (d.serial_number && d.serial_number.toLowerCase() === trimmed.toLowerCase())
      ) || null
    );
  }

  async createProduct(params: { name: string; brand: string; category?: string }): Promise<Product> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { data, error } = await supabase.from('products').insert({
        name: params.name.trim(),
        brand: params.brand.trim(),
        category: params.category?.trim() || 'Thiết bị CNTT',
      }).select('*').single();
      if (error) throw error;
      return data;
    }
    const newProd: Product = {
      id: `prod-${Date.now()}`,
      name: params.name.trim(),
      brand: params.brand.trim(),
      category: params.category?.trim() || 'Thiết bị CNTT',
      created_at: new Date().toISOString(),
    };
    this.products.push(newProd);
    this.persistMock();
    return newProd;
  }

  async createParty(params: { name: string; type: Party['type']; phone?: string; email?: string; notes?: string }): Promise<Party> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { data, error } = await supabase.from('parties').insert({
        name: params.name.trim(),
        type: params.type,
        phone: params.phone?.trim() || null,
        email: params.email?.trim() || null,
        notes: params.notes?.trim() || null,
      }).select('*').single();
      if (error) throw error;
      return data;
    }
    const newParty: Party = {
      id: `party-${Date.now()}`,
      name: params.name.trim(),
      type: params.type,
      phone: params.phone?.trim() || undefined,
      email: params.email?.trim() || undefined,
      notes: params.notes?.trim() || undefined,
      created_at: new Date().toISOString(),
    };
    this.parties.push(newParty);
    this.persistMock();
    return newParty;
  }


  // --- BUSINESS RULES & READINESS ---
  checkOutboundReadiness(device: Device): { eligible: boolean; reason?: string } {
    if (device.owner_type !== 'INTERNAL') {
      return { eligible: false, reason: 'Thiết bị không thuộc sở hữu nội bộ (đã bán hoặc chuyển giao)' };
    }
    if (device.holder_type !== 'INTERNAL_STORAGE') {
      return { eligible: false, reason: 'Thiết bị hiện không có ở kho (đang cho mượn hoặc bảo hành)' };
    }
    if (device.lifecycle !== 'ACTIVE') {
      return { eligible: false, reason: `Thiết bị có vòng đời là ${device.lifecycle} (không thể xuất)` };
    }
    if (device.technical_condition !== 'USABLE') {
      return { eligible: false, reason: `Tình trạng kỹ thuật là ${device.technical_condition} (cần kiểm tra/lỗi)` };
    }
    if (device.active_assignment) {
      return { eligible: false, reason: 'Thiết bị đang có lượt bàn giao chưa thu hồi' };
    }
    if (device.active_warranty_case && device.active_warranty_case.case_status !== 'COMPLETED') {
      return { eligible: false, reason: 'Thiết bị đang trong hồ sơ bảo hành chưa hoàn tất' };
    }
    return { eligible: true };
  }

  // Helper convert base64 DataURL to Blob
  private dataURLtoBlob(dataurl: string): Blob {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  // --- ACTIONS ---
  async confirmInboundReceipt(data: {
    supplier_id: string;
    items: Array<{
      product_id: string;
      serial_number?: string;
      management_code: string;
      technical_condition: 'USABLE' | 'NEEDS_INSPECTION';
      photo?: string;
      supplier_warranty?: {
        has_warranty: boolean;
        start_date?: string;
        end_date?: string;
        terms_note?: string;
      };
    }>;
  }): Promise<{ success: boolean; message: string }> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      // Call Supabase RPC
      const receiptCode = `PN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const { data: rec, error: recErr } = await supabase
        .from('inbound_receipts')
        .insert({ code: receiptCode, supplier_id: data.supplier_id, status: 'DRAFT' })
        .select()
        .single();
      if (recErr) throw recErr;

      // Chuẩn bị payload thiết bị gửi sang RPC (bỏ trường photo vì RPC không nhận trường này)
      const rpcDevices = data.items.map((item) => ({
        product_id: item.product_id,
        management_code: item.management_code,
        serial_number: item.serial_number,
        technical_condition: item.technical_condition,
        supplier_warranty: item.supplier_warranty,
      }));

      const { error: rpcErr } = await supabase.rpc('rpc_confirm_inbound_receipt', {
        p_receipt_id: rec.id,
        p_devices: rpcDevices,
      });
      if (rpcErr) throw rpcErr;

      // Xử lý upload ảnh chứng từ cho các thiết bị có snapshot quét mã
      const itemsWithPhotos = data.items.filter((i) => !!i.photo);
      if (itemsWithPhotos.length > 0) {
        try {
          const { data: createdDevices } = await supabase
            .from('devices')
            .select('id, management_code, serial_number')
            .eq('inbound_receipt_id', rec.id);

          for (const item of itemsWithPhotos) {
            try {
              const matchingDev = createdDevices?.find(
                (d) =>
                  (item.serial_number && d.serial_number === item.serial_number) ||
                  d.management_code === item.management_code
              );
              const devId = matchingDev?.id || null;
              const blob = this.dataURLtoBlob(item.photo!);
              const fileName = `${matchingDev?.management_code || item.management_code || 'dev'}_${Date.now()}.jpg`;
              const storagePath = `inbound/${rec.id}/${fileName}`;

              const { error: uploadError } = await supabase.storage
                .from('evidence-photos')
                .upload(storagePath, blob, {
                  contentType: 'image/jpeg',
                  upsert: true,
                });

              if (!uploadError) {
                await supabase.from('evidence_photos').insert({
                  entity_type: 'INBOUND_RECEIPT',
                  entity_id: rec.id,
                  device_id: devId,
                  storage_key: storagePath,
                  watermark_meta: {
                    serial_number: item.serial_number,
                    management_code: item.management_code,
                    scanned_at: new Date().toISOString(),
                  },
                });
              } else {
                console.warn('Upload ảnh evidence-photos thất bại:', uploadError);
              }
            } catch (pErr) {
              console.warn('Lỗi xử lý từng ảnh chứng từ:', pErr);
            }
          }
        } catch (photoBatchErr) {
          console.warn('Lỗi tải ảnh chứng từ nhập kho:', photoBatchErr);
        }
      }

      return { success: true, message: `Đã nhập kho thành công phiếu ${receiptCode} (kèm ảnh chứng từ)` };
    }

    // Mock Mode Execution
    for (const item of data.items) {
      if (item.serial_number) {
        const dup = this.devices.find(
          (d) => d.serial_number === item.serial_number && d.lifecycle === 'ACTIVE'
        );
        if (dup) {
          throw new Error(`Serial ${item.serial_number} đã tồn tại trong hệ thống!`);
        }
      }

      const prod = this.products.find((p) => p.id === item.product_id);
      const newDevId = `d-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const newDev: Device = {
        id: newDevId,
        product_id: item.product_id,
        product: prod,
        management_code: item.management_code,
        serial_number: item.serial_number || null,
        owner_type: 'INTERNAL',
        holder_type: 'INTERNAL_STORAGE',
        technical_condition: item.technical_condition,
        lifecycle: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        photo_url: item.photo || null,
        supplier_warranty: item.supplier_warranty
          ? {
              id: `sw-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              device_id: newDevId,
              policy_type: 'SUPPLIER_POLICY',
              source_event_type: 'INBOUND',
              source_event_id: 'mock-rec',
              has_warranty: item.supplier_warranty.has_warranty,
              start_date: item.supplier_warranty.start_date || new Date().toISOString().slice(0, 10),
              end_date: item.supplier_warranty.end_date,
              terms_note: item.supplier_warranty.terms_note,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          : null,
        evidence_photos: item.photo
          ? [
              {
                id: `photo-${Date.now()}`,
                entity_type: 'INBOUND_RECEIPT',
                entity_id: 'mock-rec',
                device_id: newDevId,
                storage_key: item.photo,
                created_at: new Date().toISOString(),
              },
            ]
          : [],
      };
      this.devices.unshift(newDev);
    }
    this.persistMock();
    return { success: true, message: `Đã nhập thành công ${data.items.length} thiết bị` };
  }

  async confirmOutboundReceipt(data: {
    recipient_id: string;
    outbound_type: 'SALE_INDIVIDUAL' | 'SALE_ORG' | 'GIVE_PERMANENT' | 'RETURN_SUPPLIER';
    device_ids: string[];
    customer_warranty?: {
      has_warranty: boolean;
      start_date?: string;
      end_date?: string;
      terms_note?: string;
    };
  }): Promise<{ success: boolean; message: string }> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const code = `PX-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const { data: rec, error: recErr } = await supabase
        .from('outbound_receipts')
        .insert({
          code,
          recipient_party_id: data.recipient_id,
          outbound_type: data.outbound_type,
          status: 'DRAFT',
        })
        .select()
        .single();
      if (recErr) throw recErr;

      const { error: rpcErr } = await supabase.rpc('rpc_confirm_outbound_receipt', {
        p_receipt_id: rec.id,
        p_device_ids: data.device_ids,
        p_customer_warranty: data.customer_warranty || null,
      });
      if (rpcErr) throw rpcErr;
      return { success: true, message: `Đã xuất kho thành công phiếu ${code}` };
    }

    // Mock Mode
    const recipient = this.parties.find((p) => p.id === data.recipient_id);
    for (const devId of data.device_ids) {
      const dev = this.devices.find((d) => d.id === devId);
      if (!dev) throw new Error('Không tìm thấy thiết bị');
      const readiness = this.checkOutboundReadiness(dev);
      if (!readiness.eligible) {
        throw new Error(`Thiết bị ${dev.management_code}: ${readiness.reason}`);
      }

      if (['SALE_INDIVIDUAL', 'SALE_ORG', 'GIVE_PERMANENT'].includes(data.outbound_type)) {
        dev.owner_type = 'EXTERNAL';
        dev.owner_party_id = data.recipient_id;
        dev.owner_party = recipient;
        dev.holder_type = 'EXTERNAL_PARTY';
        dev.holder_party_id = data.recipient_id;
        dev.holder_party = recipient;

        if (data.customer_warranty && data.customer_warranty.has_warranty) {
          dev.customer_warranty = {
            id: `cw-${Date.now()}-${dev.id}`,
            device_id: dev.id,
            policy_type: 'CUSTOMER_POLICY',
            source_event_type: 'OUTBOUND_SALE',
            source_event_id: 'mock-px',
            has_warranty: true,
            start_date: data.customer_warranty.start_date || new Date().toISOString().slice(0, 10),
            end_date: data.customer_warranty.end_date,
            terms_note: data.customer_warranty.terms_note,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }
      } else if (data.outbound_type === 'RETURN_SUPPLIER') {
        dev.lifecycle = 'RETURNED_SUPPLIER';
        dev.holder_type = 'EXTERNAL_PARTY';
        dev.holder_party_id = data.recipient_id;
      }
      dev.outbound_date = new Date().toISOString();
    }
    this.persistMock();
    return { success: true, message: `Đã xuất ${data.device_ids.length} thiết bị thành công` };
  }

  async createAssignment(data: {
    device_id: string;
    recipient_id: string;
    assignment_type: 'LOAN' | 'LONG_TERM_ASSIGNMENT';
    expected_return_date?: string;
    notes?: string;
  }): Promise<{ success: boolean; message: string }> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const now = new Date().toISOString();

      // 1. Ghi log assignment vào Supabase
      const { error: asgErr } = await supabase.from('assignments').insert({
        device_id: data.device_id,
        recipient_party_id: data.recipient_id,
        assignment_type: data.assignment_type,
        checkout_date: now,
        expected_return_date: data.expected_return_date || null,
        checkout_condition: 'USABLE',
        checkout_notes: data.notes || null,
      });
      if (asgErr) throw new Error('Không thể tạo phiếu bàn giao: ' + asgErr.message);

      // 2. Chuyển thiết bị sang EXTERNAL_PARTY
      const { error: devErr } = await supabase
        .from('devices')
        .update({
          holder_type: 'EXTERNAL_PARTY',
          holder_party_id: data.recipient_id,
        })
        .eq('id', data.device_id);
      if (devErr) throw new Error('Không thể cập nhật trạng thái thiết bị: ' + devErr.message);

      return { success: true, message: 'Đã bàn giao thiết bị thành công' };
    }

    const dev = this.devices.find((d) => d.id === data.device_id);
    if (!dev) throw new Error('Không tìm thấy thiết bị');
    const readiness = this.checkOutboundReadiness(dev);
    if (!readiness.eligible) throw new Error(readiness.reason);

    const recipient = this.parties.find((p) => p.id === data.recipient_id);
    dev.holder_type = 'EXTERNAL_PARTY';
    dev.holder_party_id = data.recipient_id;
    dev.holder_party = recipient;

    const asg: Assignment = {
      id: `asg-${Date.now()}`,
      device_id: data.device_id,
      recipient_party_id: data.recipient_id,
      recipient_party: recipient,
      assignment_type: data.assignment_type,
      checkout_date: new Date().toISOString(),
      expected_return_date: data.expected_return_date || null,
      checkout_condition: 'USABLE',
      checkout_notes: data.notes,
      created_at: new Date().toISOString(),
    };
    dev.active_assignment = asg;
    this.assignments.unshift(asg);
    this.persistMock();
    return { success: true, message: `Đã bàn giao thiết bị cho ${recipient?.name}` };
  }

  async returnAssignment(data: {
    device_id: string;
    condition: 'USABLE' | 'NEEDS_INSPECTION' | 'FAULTY';
    notes?: string;
  }): Promise<{ success: boolean; message: string }> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const now = new Date().toISOString();

      // 1. Đóng lượt bàn giao / mượn đang mở (checkin_date IS NULL)
      const { data: openAsgs, error: findErr } = await supabase
        .from('assignments')
        .select('id')
        .eq('device_id', data.device_id)
        .is('checkin_date', null)
        .order('created_at', { ascending: false });

      if (openAsgs && openAsgs.length > 0) {
        for (const asg of openAsgs) {
          await supabase
            .from('assignments')
            .update({
              checkin_date: now,
              checkin_condition: data.condition,
              checkin_notes: data.notes || null,
            })
            .eq('id', asg.id);
        }
      }

      // 2. Chuyển thiết bị về kho nội bộ
      const { error: devErr } = await supabase
        .from('devices')
        .update({
          holder_type: 'INTERNAL_STORAGE',
          holder_party_id: null,
          technical_condition: data.condition,
        })
        .eq('id', data.device_id);

      if (devErr) {
        console.error('Lỗi cập nhật thiết bị:', devErr);
        throw new Error('Không thể cập nhật trạng thái thiết bị: ' + devErr.message);
      }

      return { success: true, message: 'Đã thu hồi thiết bị về kho thành công' };
    }

    const dev = this.devices.find((d) => d.id === data.device_id);
    if (!dev) throw new Error('Không tìm thấy thiết bị');
    if (dev.active_assignment) {
      dev.active_assignment.checkin_date = new Date().toISOString();
      dev.active_assignment.checkin_condition = data.condition;
      dev.active_assignment.checkin_notes = data.notes;
    }

    dev.holder_type = 'INTERNAL_STORAGE';
    dev.holder_party_id = null;
    dev.holder_party = undefined;
    dev.technical_condition = data.condition;
    dev.active_assignment = null;
    dev.outbound_date = null;

    this.persistMock();
    return { success: true, message: 'Đã thu hồi thiết bị về kho thành công' };
  }

  // --- WARRANTY APIS ---
  async getWarrantyCases(): Promise<WarrantyCase[]> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('warranty_cases')
        .select(`
          *,
          device:devices!warranty_cases_device_id_fkey(*, product:products(*)),
          replaced_device:devices!warranty_cases_replaced_by_device_id_fkey(*, product:products(*)),
          customer:parties(*)
        `)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('Lỗi khi tải danh sách bảo hành từ Supabase:', error);
      } else if (data) {
        return data as WarrantyCase[];
      }
    }
    return this.warrantyCases;
  }

  async createWarrantyCase(data: {
    device_id: string;
    reported_fault: string;
    accessories?: string;
  }): Promise<{ success: boolean; case_id: string; case_code: string }> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { data: res, error } = await supabase.rpc('rpc_create_warranty_case', {
        p_device_id: data.device_id,
        p_reported_fault: data.reported_fault,
        p_accessories: data.accessories || null,
        p_performer: 'Admin',
      });
      if (error) throw error;
      return res;
    }

    // Mock
    const dev = this.devices.find((d) => d.id === data.device_id);
    if (!dev) throw new Error('Không tìm thấy thiết bị');
    const existing = this.warrantyCases.find(
      (c) => (c.device_id === dev.id || c.replaced_by_device_id === dev.id) && c.case_status !== 'COMPLETED'
    );
    if (existing) throw new Error(`Thiết bị đang có hồ sơ bảo hành chưa hoàn tất (${existing.code})`);

    const code = `BH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newCase: WarrantyCase = {
      id: `wcase-${Date.now()}`,
      code,
      device_id: dev.id,
      device: dev,
      customer_id: dev.owner_party_id || 'pt-2',
      customer: dev.owner_party,
      case_status: 'RECEIVED_CUSTOMER',
      snapshot_supplier_policy: dev.supplier_warranty || { has_warranty: false, terms_note: 'Chưa có thông tin' },
      snapshot_customer_policy: dev.customer_warranty || { has_warranty: false, terms_note: 'Chưa có thông tin' },
      reported_fault: data.reported_fault,
      accessories_received: data.accessories,
      is_device_replaced: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    dev.holder_type = 'INTERNAL_STORAGE';
    dev.technical_condition = 'NEEDS_INSPECTION';
    dev.active_warranty_case = newCase;
    this.warrantyCases.unshift(newCase);
    this.persistMock();
    return { success: true, case_id: newCase.id, case_code: code };
  }

  async transitionWarrantyCase(data: {
    case_id: string;
    to_status: 'SENT_SUPPLIER' | 'RECEIVED_FROM_SUPPLIER' | 'RESOLVED_WAITING_RETURN' | 'COMPLETED';
    action_type: string;
    notes?: string;
    repair_outcome?: string;
    supplier_party_id?: string;
  }): Promise<{ success: boolean; message: string }> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { data: res, error } = await supabase.rpc('rpc_transition_warranty_case', {
        p_case_id: data.case_id,
        p_to_status: data.to_status,
        p_action_type: data.action_type,
        p_notes: data.notes || null,
        p_repair_outcome: data.repair_outcome || null,
        p_supplier_party_id: data.supplier_party_id || null,
        p_performer: 'Admin',
      });
      if (error) throw error;
      return { success: true, message: `Đã chuyển sang trạng thái ${data.to_status}` };
    }

    // Mock
    const wc = this.warrantyCases.find((c) => c.id === data.case_id);
    if (!wc) throw new Error('Không tìm thấy hồ sơ bảo hành');
    const dev = this.devices.find((d) => d.id === (wc.replaced_by_device_id || wc.device_id));

    if (data.to_status === 'SENT_SUPPLIER') {
      if (dev) {
        dev.holder_type = 'SUPPLIER_WARRANTY';
        dev.holder_party_id = data.supplier_party_id || null;
      }
    } else if (data.to_status === 'RECEIVED_FROM_SUPPLIER') {
      if (dev) {
        dev.holder_type = 'INTERNAL_STORAGE';
        dev.holder_party_id = null;
      }
      if (data.repair_outcome) wc.repair_outcome = data.repair_outcome;
    } else if (data.to_status === 'RESOLVED_WAITING_RETURN') {
      if (data.repair_outcome) wc.repair_outcome = data.repair_outcome;
    } else if (data.to_status === 'COMPLETED') {
      if (dev) {
        if (dev.owner_type === 'EXTERNAL') {
          dev.holder_type = 'EXTERNAL_PARTY';
          dev.holder_party_id = dev.owner_party_id;
        } else {
          dev.holder_type = 'INTERNAL_STORAGE';
        }
        dev.technical_condition = 'USABLE';
        dev.active_warranty_case = null;
      }
    }
    wc.case_status = data.to_status;
    wc.updated_at = new Date().toISOString();
    this.persistMock();
    return { success: true, message: `Đã chuyển trạng thái sang ${data.to_status}` };
  }

  async replaceWarrantyDevice(data: {
    case_id: string;
    new_serial_number?: string;
    new_management_code: string;
    new_warranty_policy?: {
      has_warranty: boolean;
      start_date?: string;
      end_date?: string;
      terms_note?: string;
    };
    reason?: string;
  }): Promise<{ success: boolean; message: string }> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { data: res, error } = await supabase.rpc('rpc_replace_warranty_device', {
        p_case_id: data.case_id,
        p_new_serial_number: data.new_serial_number || null,
        p_new_management_code: data.new_management_code,
        p_new_warranty_policy: data.new_warranty_policy || null,
        p_reason: data.reason || 'NCC đổi thiết bị mới',
        p_performer: 'Admin',
      });
      if (error) throw error;
      return { success: true, message: 'Đã hoàn tất đổi thiết bị bảo hành' };
    }

    // Mock
    const wc = this.warrantyCases.find((c) => c.id === data.case_id);
    if (!wc) throw new Error('Không tìm thấy hồ sơ');
    const oldDev = this.devices.find((d) => d.id === wc.device_id);
    if (!oldDev) throw new Error('Không tìm thấy máy cũ');

    oldDev.lifecycle = 'REPLACED';
    const newDev: Device = {
      id: `d-new-${Date.now()}`,
      product_id: oldDev.product_id,
      product: oldDev.product,
      management_code: data.new_management_code,
      serial_number: data.new_serial_number || null,
      owner_type: oldDev.owner_type,
      owner_party_id: oldDev.owner_party_id,
      owner_party: oldDev.owner_party,
      holder_type: oldDev.holder_type,
      holder_party_id: oldDev.holder_party_id,
      technical_condition: 'USABLE',
      lifecycle: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.devices.unshift(newDev);

    wc.is_device_replaced = true;
    wc.replaced_by_device_id = newDev.id;
    wc.repair_outcome = (wc.repair_outcome ? wc.repair_outcome + ' ' : '') + `[Đổi SN mới: ${data.new_serial_number || data.new_management_code}]`;
    this.persistMock();
    return { success: true, message: `Đã đổi sang thiết bị mới: ${newDev.management_code}` };
  }

  // --- CẬP NHẬT CHÍNH SÁCH BẢO HÀNH (NCC & KHÁCH HÀNG) ---
  async updateWarrantyPolicy(params: {
    device_id: string;
    supplier_warranty?: {
      has_warranty: boolean;
      start_date?: string;
      end_date?: string;
      terms_note?: string;
    };
    customer_warranty?: {
      has_warranty: boolean;
      start_date?: string;
      end_date?: string;
      terms_note?: string;
    };
  }): Promise<{ success: boolean; message: string }> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();

      if (params.supplier_warranty) {
        const { data: existing } = await supabase
          .from('warranty_policies')
          .select('id')
          .eq('device_id', params.device_id)
          .eq('policy_type', 'SUPPLIER_POLICY')
          .maybeSingle();

        if (existing) {
          await supabase
            .from('warranty_policies')
            .update({
              has_warranty: params.supplier_warranty.has_warranty,
              start_date: params.supplier_warranty.start_date || null,
              end_date: params.supplier_warranty.end_date || null,
              terms_note: params.supplier_warranty.terms_note || null,
              source_event_type: 'MANUAL_OVERRIDE',
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
        } else {
          await supabase.from('warranty_policies').insert({
            device_id: params.device_id,
            policy_type: 'SUPPLIER_POLICY',
            source_event_type: 'MANUAL_OVERRIDE',
            source_event_id: params.device_id,
            has_warranty: params.supplier_warranty.has_warranty,
            start_date: params.supplier_warranty.start_date || null,
            end_date: params.supplier_warranty.end_date || null,
            terms_note: params.supplier_warranty.terms_note || null,
          });
        }
      }

      if (params.customer_warranty) {
        const { data: existing } = await supabase
          .from('warranty_policies')
          .select('id')
          .eq('device_id', params.device_id)
          .eq('policy_type', 'CUSTOMER_POLICY')
          .maybeSingle();

        if (existing) {
          await supabase
            .from('warranty_policies')
            .update({
              has_warranty: params.customer_warranty.has_warranty,
              start_date: params.customer_warranty.start_date || null,
              end_date: params.customer_warranty.end_date || null,
              terms_note: params.customer_warranty.terms_note || null,
              source_event_type: 'MANUAL_OVERRIDE',
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
        } else {
          await supabase.from('warranty_policies').insert({
            device_id: params.device_id,
            policy_type: 'CUSTOMER_POLICY',
            source_event_type: 'MANUAL_OVERRIDE',
            source_event_id: params.device_id,
            has_warranty: params.customer_warranty.has_warranty,
            start_date: params.customer_warranty.start_date || null,
            end_date: params.customer_warranty.end_date || null,
            terms_note: params.customer_warranty.terms_note || null,
          });
        }
      }
      return { success: true, message: 'Đã cập nhật chính sách bảo hành thành công' };
    }

    // Mock Mode
    const dev = this.devices.find((d) => d.id === params.device_id);
    if (!dev) throw new Error('Không tìm thấy thiết bị');

    if (params.supplier_warranty) {
      dev.supplier_warranty = {
        id: dev.supplier_warranty?.id || `wp-sup-${Date.now()}`,
        device_id: dev.id,
        policy_type: 'SUPPLIER_POLICY',
        source_event_type: 'MANUAL_OVERRIDE',
        source_event_id: dev.id,
        has_warranty: params.supplier_warranty.has_warranty,
        start_date: params.supplier_warranty.start_date,
        end_date: params.supplier_warranty.end_date,
        terms_note: params.supplier_warranty.terms_note,
        created_at: dev.supplier_warranty?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    if (params.customer_warranty) {
      dev.customer_warranty = {
        id: dev.customer_warranty?.id || `wp-cus-${Date.now()}`,
        device_id: dev.id,
        policy_type: 'CUSTOMER_POLICY',
        source_event_type: 'MANUAL_OVERRIDE',
        source_event_id: dev.id,
        has_warranty: params.customer_warranty.has_warranty,
        start_date: params.customer_warranty.start_date,
        end_date: params.customer_warranty.end_date,
        terms_note: params.customer_warranty.terms_note,
        created_at: dev.customer_warranty?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    this.persistMock();
    return { success: true, message: 'Đã cập nhật chính sách bảo hành thành công' };
  }
}

export const inventoryService = new InventoryService();
