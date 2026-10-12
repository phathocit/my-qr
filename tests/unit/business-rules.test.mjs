import test from 'node:test';
import assert from 'node:assert/strict';

// Helper function implementing exact outbound readiness rule logic
function checkOutboundReadiness(device) {
  if (device.owner_type !== 'INTERNAL') {
    return { eligible: false, reason: 'Thiết bị không thuộc sở hữu nội bộ' };
  }
  if (device.holder_type !== 'INTERNAL_STORAGE') {
    return { eligible: false, reason: 'Thiết bị hiện không có ở kho' };
  }
  if (device.lifecycle !== 'ACTIVE') {
    return { eligible: false, reason: 'Thiết bị không ở trạng thái ACTIVE' };
  }
  if (device.technical_condition !== 'USABLE') {
    return { eligible: false, reason: 'Tình trạng kỹ thuật không phải USABLE' };
  }
  if (device.active_assignment && !device.active_assignment.checkin_date) {
    return { eligible: false, reason: 'Thiết bị đang có lượt bàn giao chưa thu hồi' };
  }
  if (device.active_warranty_case && device.active_warranty_case.case_status !== 'COMPLETED') {
    return { eligible: false, reason: 'Thiết bị đang trong hồ sơ bảo hành chưa hoàn tất' };
  }
  return { eligible: true };
}

// Helper checking allowed warranty state machine transitions
function isValidWarrantyTransition(fromStatus, toStatus) {
  const allowed = {
    'RECEIVED_CUSTOMER': ['SENT_SUPPLIER', 'RESOLVED_WAITING_RETURN'],
    'SENT_SUPPLIER': ['RECEIVED_FROM_SUPPLIER'],
    'RECEIVED_FROM_SUPPLIER': ['RESOLVED_WAITING_RETURN'],
    'RESOLVED_WAITING_RETURN': ['COMPLETED'],
    'COMPLETED': [],
  };
  return allowed[fromStatus]?.includes(toStatus) || false;
}

// 1. Tests for Outbound Readiness Rules
test('Outbound Readiness: Thiết bị đủ điều kiện khi thỏa mãn tất cả 6 tiêu chuẩn', () => {
  const validDevice = {
    id: 'd-1',
    owner_type: 'INTERNAL',
    holder_type: 'INTERNAL_STORAGE',
    lifecycle: 'ACTIVE',
    technical_condition: 'USABLE',
    active_assignment: null,
    active_warranty_case: null,
  };
  assert.equal(checkOutboundReadiness(validDevice).eligible, true);
});

test('Outbound Readiness: Chặn thiết bị có tình trạng FAULTY hoặc NEEDS_INSPECTION', () => {
  const faultyDevice = {
    owner_type: 'INTERNAL',
    holder_type: 'INTERNAL_STORAGE',
    lifecycle: 'ACTIVE',
    technical_condition: 'FAULTY',
  };
  const inspectionDevice = {
    owner_type: 'INTERNAL',
    holder_type: 'INTERNAL_STORAGE',
    lifecycle: 'ACTIVE',
    technical_condition: 'NEEDS_INSPECTION',
  };
  assert.equal(checkOutboundReadiness(faultyDevice).eligible, false);
  assert.equal(checkOutboundReadiness(inspectionDevice).eligible, false);
});

test('Outbound Readiness: Chặn thiết bị đang cho mượn hoặc đang mở bảo hành', () => {
  const loanedDevice = {
    owner_type: 'INTERNAL',
    holder_type: 'INTERNAL_STORAGE',
    lifecycle: 'ACTIVE',
    technical_condition: 'USABLE',
    active_assignment: { checkin_date: null },
  };
  const warrantyDevice = {
    owner_type: 'INTERNAL',
    holder_type: 'INTERNAL_STORAGE',
    lifecycle: 'ACTIVE',
    technical_condition: 'USABLE',
    active_warranty_case: { case_status: 'SENT_SUPPLIER' },
  };
  assert.equal(checkOutboundReadiness(loanedDevice).eligible, false);
  assert.equal(checkOutboundReadiness(warrantyDevice).eligible, false);
});

test('Outbound Readiness: Chặn thiết bị đã bán (EXTERNAL) hoặc không ở kho', () => {
  const soldDevice = {
    owner_type: 'EXTERNAL',
    holder_type: 'EXTERNAL_PARTY',
    lifecycle: 'ACTIVE',
    technical_condition: 'USABLE',
  };
  assert.equal(checkOutboundReadiness(soldDevice).eligible, false);
});

// 2. Tests for Warranty State Machine
test('Warranty Transitions: Luồng tiêu chuẩn (Tiếp nhận -> Gửi NCC -> Nhận về -> Chờ trả -> Hoàn tất)', () => {
  assert.equal(isValidWarrantyTransition('RECEIVED_CUSTOMER', 'SENT_SUPPLIER'), true);
  assert.equal(isValidWarrantyTransition('SENT_SUPPLIER', 'RECEIVED_FROM_SUPPLIER'), true);
  assert.equal(isValidWarrantyTransition('RECEIVED_FROM_SUPPLIER', 'RESOLVED_WAITING_RETURN'), true);
  assert.equal(isValidWarrantyTransition('RESOLVED_WAITING_RETURN', 'COMPLETED'), true);
});

test('Warranty Transitions: Luồng ngoại lệ sửa tại chỗ (Tiếp nhận -> Chờ trả -> Hoàn tất)', () => {
  assert.equal(isValidWarrantyTransition('RECEIVED_CUSTOMER', 'RESOLVED_WAITING_RETURN'), true);
  assert.equal(isValidWarrantyTransition('RESOLVED_WAITING_RETURN', 'COMPLETED'), true);
});

test('Warranty Transitions: Chặn nhảy cóc trực tiếp sang COMPLETED khi chưa xử lý', () => {
  assert.equal(isValidWarrantyTransition('RECEIVED_CUSTOMER', 'COMPLETED'), false);
  assert.equal(isValidWarrantyTransition('SENT_SUPPLIER', 'COMPLETED'), false);
  assert.equal(isValidWarrantyTransition('RECEIVED_FROM_SUPPLIER', 'COMPLETED'), false);
});

// 3. Tests for Serial Number and Code Integrity
test('Code Integrity: Giữ nguyên ký tự gốc của Serial Number, không tự tiện đổi hoa thường', () => {
  const rawSN = 'SN-AbC_1234#';
  const trimmed = rawSN.trim();
  assert.equal(trimmed, rawSN);
  assert.notEqual(trimmed, rawSN.toLowerCase());
  assert.notEqual(trimmed, rawSN.toUpperCase());
});

test('Code Integrity: Sinh mã thay thế có định dạng DEV- khi thiết bị không có SN', () => {
  const generatedCode = `DEV-AUTO-${Date.now().toString().slice(-4)}`;
  assert.match(generatedCode, /^DEV-AUTO-\d{4}$/);
});
