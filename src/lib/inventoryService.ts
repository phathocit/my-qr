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
  { id: 'pt-1', name: 'Công ty Cổ phần Tin học ABC', type: 'SUPPLIER', phone: '0901234567', created_at: new Date().toISOString() },
  { id: 'pt-2', name: 'Nguyễn Văn An (Cá nhân)', type: 'CUSTOMER_INDIVIDUAL', phone: '0988776655', created_at: new Date().toISOString() },
  { id: 'pt-3', name: 'Công ty TNHH Giải Pháp Phần Mềm XYZ', type: 'CUSTOMER_ORG', phone: '0283838383', created_at: new Date().toISOString() },
  { id: 'pt-4', name: 'Trần Văn Bình (Kỹ thuật nội bộ)', type: 'INTERNAL_MEMBER', phone: '0912345678', created_at: new Date().toISOString() },
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

  async getDevices(): Promise<Device[]> {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('devices')
        .select(`
          *,
          product:products(*),
          owner_party:parties!devices_owner_party_id_fkey(*),
          holder_party:parties!devices_holder_party_id_fkey(*)
        `)
        .order('created_at', { ascending: false });
      if (!error && data) return data as Device[];
    }
    return this.devices;
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
          holder_party:parties!devices_holder_party_id_fkey(*)
        `)
        .or(`management_code.eq.${trimmed},serial_number.eq.${trimmed}`)
        .single();
      if (!error && data) return data as Device;
    }

    return (
      this.devices.find(
        (d) => d.management_code.toLowerCase() === trimmed.toLowerCase() ||
               (d.serial_number && d.serial_number.toLowerCase() === trimmed.toLowerCase())
      ) || null
    );
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

  // --- ACTIONS ---
  async confirmInboundReceipt(data: {
    supplier_id: string;
    items: Array<{
      product_id: string;
      serial_number?: string;
      management_code: string;
      technical_condition: 'USABLE' | 'NEEDS_INSPECTION';
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

      const { error: rpcErr } = await supabase.rpc('rpc_confirm_inbound_receipt', {
        p_receipt_id: rec.id,
        p_devices: data.items,
      });
      if (rpcErr) throw rpcErr;
      return { success: true, message: `Đã nhập kho thành công phiếu ${receiptCode}` };
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
      const newDev: Device = {
        id: `d-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
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
      } else if (data.outbound_type === 'RETURN_SUPPLIER') {
        dev.lifecycle = 'RETURNED_SUPPLIER';
        dev.holder_type = 'EXTERNAL_PARTY';
        dev.holder_party_id = data.recipient_id;
      }
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
    const dev = this.devices.find((d) => d.id === data.device_id);
    if (!dev) throw new Error('Không tìm thấy thiết bị');
    if (!dev.active_assignment) throw new Error('Thiết bị không có bản ghi bàn giao đang mở');

    dev.active_assignment.checkin_date = new Date().toISOString();
    dev.active_assignment.checkin_condition = data.condition;
    dev.active_assignment.checkin_notes = data.notes;

    dev.holder_type = 'INTERNAL_STORAGE';
    dev.holder_party_id = null;
    dev.holder_party = undefined;
    dev.technical_condition = data.condition;
    dev.active_assignment = null;

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
          device:devices(*, product:products(*)),
          customer:parties(*)
        `)
        .order('created_at', { ascending: false });
      if (!error && data) return data as WarrantyCase[];
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
}

export const inventoryService = new InventoryService();
