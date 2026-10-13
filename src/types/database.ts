export type OwnershipType = 'INTERNAL' | 'EXTERNAL';
export type CustodyType = 'INTERNAL_STORAGE' | 'EXTERNAL_PARTY' | 'SUPPLIER_WARRANTY';
export type TechnicalCondition = 'USABLE' | 'NEEDS_INSPECTION' | 'FAULTY';
export type LifecycleStatus = 'ACTIVE' | 'REPLACED' | 'RETURNED_SUPPLIER';

export type PartyType = 'SUPPLIER' | 'CUSTOMER_INDIVIDUAL' | 'CUSTOMER_ORG' | 'INTERNAL_MEMBER';
export type AssignmentType = 'LOAN' | 'LONG_TERM_ASSIGNMENT';
export type ReceiptStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
export type OutboundType = 'SALE_INDIVIDUAL' | 'SALE_ORG' | 'GIVE_PERMANENT' | 'RETURN_SUPPLIER';

export type WarrantyCaseStatus = 
  | 'RECEIVED_CUSTOMER'
  | 'SENT_SUPPLIER'
  | 'RECEIVED_FROM_SUPPLIER'
  | 'RESOLVED_WAITING_RETURN'
  | 'COMPLETED';

export interface Product {
  id: string;
  name: string;
  brand: string;
  category?: string;
  created_at: string;
}

export interface Party {
  id: string;
  name: string;
  type: PartyType;
  phone?: string;
  email?: string;
  notes?: string;
  created_at: string;
}

export interface WarrantyPolicy {
  id: string;
  device_id: string;
  policy_type: 'SUPPLIER_POLICY' | 'CUSTOMER_POLICY';
  source_event_type: 'INBOUND' | 'OUTBOUND_SALE' | 'OUTBOUND_ASSIGNMENT' | 'MANUAL_OVERRIDE';
  source_event_id: string;
  has_warranty: boolean;
  start_date?: string | null;
  end_date?: string | null;
  terms_note?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Device {
  id: string;
  product_id: string;
  product?: Product;
  management_code: string;
  serial_number?: string | null;
  owner_type: OwnershipType;
  owner_party_id?: string | null;
  owner_party?: Party;
  holder_type: CustodyType;
  holder_party_id?: string | null;
  holder_party?: Party;
  technical_condition: TechnicalCondition;
  lifecycle: LifecycleStatus;
  inbound_receipt_id?: string | null;
  created_at: string;
  updated_at: string;
  supplier_warranty?: WarrantyPolicy | null;
  customer_warranty?: WarrantyPolicy | null;
  active_assignment?: Assignment | null;
  active_warranty_case?: WarrantyCase | null;
  evidence_photos?: EvidencePhoto[] | null;
  photo_url?: string | null;
  inbound_receipt?: InboundReceipt | null;
  supplier?: Party | null;
}

export interface Assignment {
  id: string;
  device_id: string;
  recipient_party_id: string;
  recipient_party?: Party;
  assignment_type: AssignmentType;
  checkout_date: string;
  expected_return_date?: string | null;
  checkin_date?: string | null;
  checkout_condition: TechnicalCondition;
  checkin_condition?: TechnicalCondition | null;
  checkout_notes?: string | null;
  checkin_notes?: string | null;
  created_at: string;
}

export interface InboundReceipt {
  id: string;
  code: string;
  supplier_id: string;
  supplier?: Party;
  received_date: string;
  status: ReceiptStatus;
  notes?: string | null;
  created_at: string;
  items?: InboundItem[];
}

export interface InboundItem {
  id: string;
  receipt_id: string;
  product_id: string;
  product?: Product;
  expected_quantity: number;
  actual_quantity: number;
}

export interface OutboundReceipt {
  id: string;
  code: string;
  recipient_party_id: string;
  recipient?: Party;
  outbound_type: OutboundType;
  outbound_date: string;
  status: ReceiptStatus;
  notes?: string | null;
  created_at: string;
  items?: OutboundItem[];
}

export interface OutboundItem {
  id: string;
  receipt_id: string;
  device_id: string;
  device?: Device;
}

export interface WarrantyCase {
  id: string;
  code: string;
  device_id: string;
  device?: Device;
  customer_id: string;
  customer?: Party;
  case_status: WarrantyCaseStatus;
  snapshot_supplier_policy?: Record<string, unknown> | WarrantyPolicy | null;
  snapshot_customer_policy?: Record<string, unknown> | WarrantyPolicy | null;
  reported_fault: string;
  accessories_received?: string | null;
  repair_outcome?: string | null;
  is_device_replaced: boolean;
  replaced_by_device_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvidencePhoto {
  id: string;
  entity_type: string;
  entity_id: string;
  device_id?: string | null;
  storage_key: string;
  watermark_meta?: Record<string, unknown> | null;
  performer?: string;
  created_at: string;
}

export type SheetsEntityType = 'CATALOG' | 'DEVICE' | 'WARRANTY_CASE';
export type SheetsSyncStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'FATAL_ERROR';

export interface SheetsSyncOutbox {
  id: string;
  entity_type: SheetsEntityType;
  entity_id: string;
  model_id?: string | null;
  action: 'UPSERT' | 'DELETE';
  status: SheetsSyncStatus;
  retry_count: number;
  max_retries: number;
  next_retry_at: string;
  last_error?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SheetsModelMapping {
  model_id: string;
  sheet_id: number;
  tab_title: string;
  created_at: string;
  updated_at: string;
}

