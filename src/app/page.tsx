'use client';

import React, { useState, useEffect } from 'react';
import { Device, Product, Party, WarrantyCase } from '@/types/database';
import { inventoryService } from '@/lib/inventoryService';
import ScannerModal from '@/components/ScannerModal';

type Tab = 'search' | 'inbound' | 'outbound' | 'warranty' | 'inventory';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const [isMock, setIsMock] = useState(true);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Core Data
  const [products, setProducts] = useState<Product[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [warrantyCases, setWarrantyCases] = useState<WarrantyCase[]>([]);
  const [warrantyFilter, setWarrantyFilter] = useState<string>('ALL');

  // Scanner Modal State
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<'search' | 'inbound' | 'outbound' | 'warranty' | 'return'>('search');

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  // Inbound Form State
  const [inboundSupplierId, setInboundSupplierId] = useState('');
  const [inboundProductId, setInboundProductId] = useState('');
  const [inboundCondition, setInboundCondition] = useState<'USABLE' | 'NEEDS_INSPECTION'>('USABLE');
  const [inboundItems, setInboundItems] = useState<Array<{
    product_id: string;
    product_name: string;
    management_code: string;
    serial_number?: string;
    technical_condition: 'USABLE' | 'NEEDS_INSPECTION';
    photo?: string;
  }>>([]);

  // Outbound Form State
  const [outboundType, setOutboundType] = useState<'SALE_INDIVIDUAL' | 'SALE_ORG' | 'GIVE_PERMANENT' | 'LOAN' | 'RETURN_SUPPLIER'>('SALE_INDIVIDUAL');
  const [outboundRecipientId, setOutboundRecipientId] = useState('');
  const [outboundReturnDate, setOutboundReturnDate] = useState('');
  const [outboundSelectedDevIds, setOutboundSelectedDevIds] = useState<string[]>([]);

  // Return Form Modal
  const [returnDevice, setReturnDevice] = useState<Device | null>(null);
  const [returnCondition, setReturnCondition] = useState<'USABLE' | 'NEEDS_INSPECTION' | 'FAULTY'>('USABLE');
  const [returnNotes, setReturnNotes] = useState('');

  // Warranty Modals State
  const [selectedCase, setSelectedCase] = useState<WarrantyCase | null>(null);
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [intakeDeviceId, setIntakeDeviceId] = useState('');
  const [intakeFault, setIntakeFault] = useState('');
  const [intakeAccessories, setIntakeAccessories] = useState('');

  const [sendSupplierModalOpen, setSendSupplierModalOpen] = useState(false);
  const [sendSupplierPartyId, setSendSupplierPartyId] = useState('');
  const [sendSupplierNotes, setSendSupplierNotes] = useState('');

  const [localRepairModalOpen, setLocalRepairModalOpen] = useState(false);
  const [localRepairOutcome, setLocalRepairOutcome] = useState('');

  const [receiveSupplierModalOpen, setReceiveSupplierModalOpen] = useState(false);
  const [receiveSupplierOutcome, setReceiveSupplierOutcome] = useState('');

  const [replaceDeviceModalOpen, setReplaceDeviceModalOpen] = useState(false);
  const [replaceNewSerial, setReplaceNewSerial] = useState('');
  const [replaceNewCode, setReplaceNewCode] = useState('');
  const [replaceReason, setReplaceReason] = useState('Đổi máy mới từ NCC');

  // Initial Load
  const refreshData = async () => {
    setIsMock(inventoryService.isUsingMock());
    try {
      const [prods, pts, devs, wcs] = await Promise.all([
        inventoryService.getProducts(),
        inventoryService.getParties(),
        inventoryService.getDevices(),
        inventoryService.getWarrantyCases(),
      ]);
      setProducts(prods);
      setParties(pts);
      setDevices(devs);
      setWarrantyCases(wcs);
      if (prods.length > 0 && !inboundProductId) setInboundProductId(prods[0].id);
      if (pts.length > 0 && !inboundSupplierId) {
        const sup = pts.find((p) => p.type === 'SUPPLIER');
        if (sup) setInboundSupplierId(sup.id);
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const showNotice = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // --- SCANNER HANDLER ---
  const handleScanDetected = (code: string, photo?: string) => {
    if (scannerTarget === 'search') {
      setSearchQuery(code);
      handleSearch(code);
    } else if (scannerTarget === 'inbound') {
      // Add device to inbound list continuously without resetting product!
      const currentProd = products.find((p) => p.id === inboundProductId);
      const isDuplicateInList = inboundItems.some(
        (i) => i.serial_number === code || i.management_code === code
      );
      if (isDuplicateInList) {
        showNotice(`Mã ${code} đã được quét trong danh sách phiếu này!`, 'error');
        return;
      }
      setInboundItems((prev) => [
        {
          product_id: inboundProductId,
          product_name: currentProd?.name || 'Sản phẩm',
          management_code: `DEV-${Date.now().toString().slice(-4)}`,
          serial_number: code,
          technical_condition: inboundCondition,
          photo,
        },
        ...prev,
      ]);
      showNotice(`Đã thêm thiết bị SN: ${code} vào phiếu`, 'success');
    } else if (scannerTarget === 'outbound') {
      const dev = devices.find(
        (d) => d.serial_number === code || d.management_code === code
      );
      if (!dev) {
        showNotice(`Không tìm thấy thiết bị có mã ${code}`, 'error');
        return;
      }
      const readiness = inventoryService.checkOutboundReadiness(dev);
      if (!readiness.eligible) {
        showNotice(`Không thể xuất: ${readiness.reason}`, 'error');
        return;
      }
      if (!outboundSelectedDevIds.includes(dev.id)) {
        setOutboundSelectedDevIds((prev) => [...prev, dev.id]);
        showNotice(`Đã thêm ${dev.management_code} vào phiếu xuất`, 'success');
      }
    } else if (scannerTarget === 'return') {
      const dev = devices.find(
        (d) => (d.serial_number === code || d.management_code === code) && d.active_assignment
      );
      if (!dev) {
        showNotice(`Mã ${code} không có lượt mượn/cấp đang mở để thu hồi`, 'error');
        return;
      }
      setReturnDevice(dev);
    }
  };

  // --- SEARCH HANDLER ---
  const handleSearch = async (query = searchQuery) => {
    if (!query.trim()) return;
    setLoading(true);
    const dev = await inventoryService.findDeviceByCode(query.trim());
    setSelectedDevice(dev);
    setLoading(false);
    if (!dev) {
      showNotice(`Không tìm thấy thiết bị phù hợp với mã: ${query}`, 'error');
    }
  };

  // --- CONFIRM INBOUND ---
  const handleConfirmInbound = async () => {
    if (!inboundSupplierId) {
      showNotice('Vui lòng chọn Nhà cung cấp', 'error');
      return;
    }
    if (inboundItems.length === 0) {
      showNotice('Chưa có thiết bị nào trong phiếu nhập', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await inventoryService.confirmInboundReceipt({
        supplier_id: inboundSupplierId,
        items: inboundItems.map((item) => ({
          product_id: item.product_id,
          management_code: item.management_code,
          serial_number: item.serial_number,
          technical_condition: item.technical_condition,
        })),
      });
      showNotice(res.message, 'success');
      setInboundItems([]);
      await refreshData();
      setActiveTab('inventory');
    } catch (err: any) {
      showNotice(err.message || 'Lỗi khi nhập kho', 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- CONFIRM OUTBOUND ---
  const handleConfirmOutbound = async () => {
    if (!outboundRecipientId) {
      showNotice('Vui lòng chọn người nhận / đối tác', 'error');
      return;
    }
    if (outboundSelectedDevIds.length === 0) {
      showNotice('Chưa chọn thiết bị nào để xuất', 'error');
      return;
    }

    setLoading(true);
    try {
      if (outboundType === 'LOAN') {
        for (const devId of outboundSelectedDevIds) {
          await inventoryService.createAssignment({
            device_id: devId,
            recipient_id: outboundRecipientId,
            assignment_type: 'LOAN',
            expected_return_date: outboundReturnDate || undefined,
          });
        }
        showNotice('Đã bàn giao cho mượn thành công', 'success');
      } else {
        const res = await inventoryService.confirmOutboundReceipt({
          recipient_id: outboundRecipientId,
          outbound_type: outboundType as any,
          device_ids: outboundSelectedDevIds,
        });
        showNotice(res.message, 'success');
      }
      setOutboundSelectedDevIds([]);
      await refreshData();
      setActiveTab('inventory');
    } catch (err: any) {
      showNotice(err.message || 'Lỗi khi xuất kho', 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- CONFIRM RETURN ---
  const handleConfirmReturn = async () => {
    if (!returnDevice) return;
    setLoading(true);
    try {
      const res = await inventoryService.returnAssignment({
        device_id: returnDevice.id,
        condition: returnCondition,
        notes: returnNotes,
      });
      showNotice(res.message, 'success');
      setReturnDevice(null);
      await refreshData();
      if (selectedDevice && selectedDevice.id === returnDevice.id) {
        setSelectedDevice(null);
      }
    } catch (err: any) {
      showNotice(err.message || 'Lỗi khi thu hồi', 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- WARRANTY HANDLERS ---
  const handleIntakeWarranty = async () => {
    if (!intakeDeviceId) {
      showNotice('Vui lòng chọn hoặc quét thiết bị cần bảo hành', 'error');
      return;
    }
    if (!intakeFault.trim()) {
      showNotice('Vui lòng nhập mô tả lỗi khách báo', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await inventoryService.createWarrantyCase({
        device_id: intakeDeviceId,
        reported_fault: intakeFault.trim(),
        accessories: intakeAccessories.trim() || undefined,
      });
      showNotice(`Đã tạo hồ sơ bảo hành: ${res.case_code}`, 'success');
      setIntakeModalOpen(false);
      setIntakeDeviceId('');
      setIntakeFault('');
      setIntakeAccessories('');
      await refreshData();
      setActiveTab('warranty');
    } catch (err: any) {
      showNotice(err.message || 'Lỗi khi tiếp nhận bảo hành', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleTransition = async (
    caseId: string,
    toStatus: any,
    actionType: string,
    notes?: string,
    repairOutcome?: string,
    supplierPartyId?: string
  ) => {
    setLoading(true);
    try {
      const res = await inventoryService.transitionWarrantyCase({
        case_id: caseId,
        to_status: toStatus,
        action_type: actionType,
        notes,
        repair_outcome: repairOutcome,
        supplier_party_id: supplierPartyId,
      });
      showNotice(res.message, 'success');
      setSelectedCase(null);
      await refreshData();
    } catch (err: any) {
      showNotice(err.message || 'Lỗi khi chuyển trạng thái', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendSupplierSubmit = async () => {
    if (!selectedCase) return;
    if (!sendSupplierPartyId) {
      showNotice('Vui lòng chọn đơn vị / NCC bảo hành', 'error');
      return;
    }
    await handleTransition(
      selectedCase.id,
      'SENT_SUPPLIER',
      'SEND_SUPPLIER',
      sendSupplierNotes.trim() || 'Gửi bảo hành NCC',
      undefined,
      sendSupplierPartyId
    );
    setSendSupplierModalOpen(false);
    setSendSupplierNotes('');
  };

  const handleLocalRepairSubmit = async () => {
    if (!selectedCase) return;
    if (!localRepairOutcome.trim()) {
      showNotice('Vui lòng ghi nhận kết quả xử lý tại chỗ', 'error');
      return;
    }
    await handleTransition(
      selectedCase.id,
      'RESOLVED_WAITING_RETURN',
      'LOCAL_REPAIR',
      'Xử lý trực tiếp không gửi NCC',
      localRepairOutcome.trim()
    );
    setLocalRepairModalOpen(false);
    setLocalRepairOutcome('');
  };

  const handleReceiveSupplierSubmit = async () => {
    if (!selectedCase) return;
    if (!receiveSupplierOutcome.trim()) {
      showNotice('Vui lòng ghi nhận kết quả từ NCC', 'error');
      return;
    }
    await handleTransition(
      selectedCase.id,
      'RECEIVED_FROM_SUPPLIER',
      'RECEIVE_SUPPLIER',
      'Đã nhận về từ NCC',
      receiveSupplierOutcome.trim()
    );
    setReceiveSupplierModalOpen(false);
    setReceiveSupplierOutcome('');
  };

  const handleReplaceDeviceSubmit = async () => {
    if (!selectedCase) return;
    if (!replaceNewCode.trim()) {
      showNotice('Vui lòng nhập mã quản lý cho thiết bị mới', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await inventoryService.replaceWarrantyDevice({
        case_id: selectedCase.id,
        new_serial_number: replaceNewSerial.trim() || undefined,
        new_management_code: replaceNewCode.trim(),
        reason: replaceReason.trim() || 'NCC đổi máy mới',
      });
      showNotice(res.message, 'success');
      setReplaceDeviceModalOpen(false);
      setReplaceNewSerial('');
      setReplaceNewCode('');
      setSelectedCase(null);
      await refreshData();
    } catch (err: any) {
      showNotice(err.message || 'Lỗi khi đổi thiết bị', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-title">
          <span>📦 Quản Lý Thiết Bị CNTT</span>
        </div>
        <div>
          {isMock ? (
            <span className="env-badge warning">Demo Local (Mock)</span>
          ) : (
            <span className="env-badge success">Supabase Cloud</span>
          )}
        </div>
      </header>

      {/* Notice Banner */}
      {notification && (
        <div style={{ padding: '8px 16px' }}>
          <div className={`toast-notice ${notification.type}`}>
            {notification.type === 'success' && '✓ '}
            {notification.type === 'error' && '✕ '}
            {notification.text}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="main-content">
        {/* ================= TAB 1: TRA CỨU & QUÉT ================= */}
        {activeTab === 'search' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-title">
                <span>Tra cứu nhanh thiết bị</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Nhập Serial Number hoặc Mã DEV-..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setScannerTarget('search');
                    setScannerOpen(true);
                  }}
                  title="Mở camera quét"
                >
                  📷
                </button>
              </div>
              <button className="btn btn-primary btn-full" onClick={() => handleSearch()} disabled={loading}>
                {loading ? 'Đang tìm...' : 'Tra cứu hồ sơ'}
              </button>
            </div>

            {/* Device Detail Card */}
            {selectedDevice && (
              <div className="card" style={{ borderLeft: '4px solid var(--primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                      {selectedDevice.product?.name || 'Thiết bị'}
                    </h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Mã: <strong>{selectedDevice.management_code}</strong> | SN: <strong>{selectedDevice.serial_number || '(Không có)'}</strong>
                    </div>
                  </div>
                  <span className="badge badge-internal">{selectedDevice.product?.brand}</span>
                </div>

                {/* 4 Orthogonal Status Dimensions */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                  <div className="form-group">
                    <span className="form-label">Quyền sở hữu:</span>
                    <div>
                      {selectedDevice.owner_type === 'INTERNAL' ? (
                        <span className="badge badge-internal">Nội bộ / Kho</span>
                      ) : (
                        <span className="badge badge-external">Khách: {selectedDevice.owner_party?.name || 'Khách'}</span>
                      )}
                    </div>
                  </div>
                  <div className="form-group">
                    <span className="form-label">Bên đang giữ:</span>
                    <div>
                      {selectedDevice.holder_type === 'INTERNAL_STORAGE' && <span className="badge badge-storage">Đang ở kho</span>}
                      {selectedDevice.holder_type === 'EXTERNAL_PARTY' && (
                        <span className="badge badge-external">
                          {selectedDevice.holder_party?.name || 'Khách giữ'}
                        </span>
                      )}
                      {selectedDevice.holder_type === 'SUPPLIER_WARRANTY' && <span className="badge badge-warranty">Trung tâm bảo hành</span>}
                    </div>
                  </div>
                  <div className="form-group">
                    <span className="form-label">Tình trạng kỹ thuật:</span>
                    <div>
                      {selectedDevice.technical_condition === 'USABLE' && <span className="badge badge-usable">Sử dụng tốt</span>}
                      {selectedDevice.technical_condition === 'NEEDS_INSPECTION' && <span className="badge badge-inspection">Cần kiểm tra</span>}
                      {selectedDevice.technical_condition === 'FAULTY' && <span className="badge badge-faulty">Hỏng / Lỗi</span>}
                    </div>
                  </div>
                  <div className="form-group">
                    <span className="form-label">Vòng đời:</span>
                    <div>
                      <span className="badge badge-storage">{selectedDevice.lifecycle}</span>
                    </div>
                  </div>
                </div>

                {/* 2 Warranty Policies */}
                <div style={{ background: 'var(--bg-input)', padding: 12, borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Chính sách bảo hành 2 phía:</div>
                  <div style={{ fontSize: '0.8rem' }}>
                    🏭 <strong>BH Nhà cung cấp:</strong>{' '}
                    {selectedDevice.supplier_warranty?.has_warranty ? (
                      <span style={{ color: 'var(--success)' }}>
                        Đến {selectedDevice.supplier_warranty.end_date || 'Không thời hạn'} ({selectedDevice.supplier_warranty.terms_note || 'Theo NCC'})
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Chưa có thông tin</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.8rem' }}>
                    🤝 <strong>BH Khách hàng:</strong>{' '}
                    {selectedDevice.customer_warranty?.has_warranty ? (
                      <span style={{ color: 'var(--success)' }}>
                        Đến {selectedDevice.customer_warranty.end_date || 'Không thời hạn'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Chưa có thông tin</span>
                    )}
                  </div>
                </div>

                {/* Action if loaned */}
                {selectedDevice.active_assignment && (
                  <button
                    className="btn btn-warning btn-full"
                    onClick={() => setReturnDevice(selectedDevice)}
                  >
                    🔄 Thu hồi thiết bị đang cho mượn
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: NHẬP KHO ================= */}
        {activeTab === 'inbound' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-title">
                <span>Tạo phiếu nhập từ NCC</span>
                <span className="badge badge-storage">{inboundItems.length} thiết bị</span>
              </div>

              <div className="form-group">
                <label className="form-label">Nhà cung cấp (*):</label>
                <select
                  className="select"
                  value={inboundSupplierId}
                  onChange={(e) => setInboundSupplierId(e.target.value)}
                >
                  <option value="">-- Chọn nhà cung cấp --</option>
                  {parties.filter((p) => p.type === 'SUPPLIER').map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Dòng sản phẩm đang quét (*):</label>
                <select
                  className="select"
                  value={inboundProductId}
                  onChange={(e) => setInboundProductId(e.target.value)}
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.brand} - {p.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Tình trạng khi nhập:</label>
                <select
                  className="select"
                  value={inboundCondition}
                  onChange={(e) => setInboundCondition(e.target.value as any)}
                >
                  <option value="USABLE">Hàng chuẩn / Sẵn sàng sử dụng (USABLE)</option>
                  <option value="NEEDS_INSPECTION">Hàng lỗi / Cần kiểm tra lại (NEEDS_INSPECTION)</option>
                </select>
              </div>

              {/* Action Buttons: Scan continuously or Generate code */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 2 }}
                  onClick={() => {
                    setScannerTarget('inbound');
                    setScannerOpen(true);
                  }}
                >
                  📷 Quét camera liên tục
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    // Generate Auto code without SN
                    const currentProd = products.find((p) => p.id === inboundProductId);
                    setInboundItems((prev) => [
                      {
                        product_id: inboundProductId,
                        product_name: currentProd?.name || 'Sản phẩm',
                        management_code: `DEV-AUTO-${Date.now().toString().slice(-4)}`,
                        serial_number: undefined,
                        technical_condition: inboundCondition,
                      },
                      ...prev,
                    ]);
                    showNotice('Đã tạo mã quản lý thay thế (không có SN)', 'info');
                  }}
                >
                  + Mã tự sinh
                </button>
              </div>
            </div>

            {/* List of Scanned Inbound Items */}
            {inboundItems.length > 0 && (
              <div className="card">
                <div className="card-title">
                  <span>Danh sách thực nhận ({inboundItems.length})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inboundItems.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 10,
                        background: 'var(--bg-input)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{item.product_name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          SN: {item.serial_number || '(Mã tự sinh: ' + item.management_code + ')'}
                        </div>
                      </div>
                      <button
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.1rem' }}
                        onClick={() => setInboundItems((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  className="btn btn-success btn-full"
                  onClick={handleConfirmInbound}
                  disabled={loading}
                >
                  {loading ? 'Đang lưu...' : '✓ Xác nhận hoàn tất nhập kho'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 3: XUẤT KHO & BÀN GIAO ================= */}
        {activeTab === 'outbound' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-title">
                <span>Phiếu xuất kho / Bàn giao</span>
              </div>

              <div className="form-group">
                <label className="form-label">Loại xuất kho (*):</label>
                <select
                  className="select"
                  value={outboundType}
                  onChange={(e) => setOutboundType(e.target.value as any)}
                >
                  <option value="SALE_INDIVIDUAL">Bán cho cá nhân</option>
                  <option value="SALE_ORG">Bán cho tổ chức / doanh nghiệp</option>
                  <option value="LOAN">Cho mượn (nội bộ hoặc đối tác)</option>
                  <option value="GIVE_PERMANENT">Cấp hẳn (chuyển quyền sở hữu)</option>
                  <option value="RETURN_SUPPLIER">Xuất trả nhà cung cấp</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Người nhận / Khách hàng (*):</label>
                <select
                  className="select"
                  value={outboundRecipientId}
                  onChange={(e) => setOutboundRecipientId(e.target.value)}
                >
                  <option value="">-- Chọn người nhận --</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.type})
                    </option>
                  ))}
                </select>
              </div>

              {outboundType === 'LOAN' && (
                <div className="form-group">
                  <label className="form-label">Ngày dự kiến trả lại:</label>
                  <input
                    type="date"
                    className="input"
                    value={outboundReturnDate}
                    onChange={(e) => setOutboundReturnDate(e.target.value)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary btn-full"
                  onClick={() => {
                    setScannerTarget('outbound');
                    setScannerOpen(true);
                  }}
                >
                  📷 Quét thiết bị cần xuất
                </button>
              </div>
            </div>

            {/* Selected Devices to Outbound */}
            {outboundSelectedDevIds.length > 0 && (
              <div className="card">
                <div className="card-title">
                  <span>Thiết bị chọn xuất ({outboundSelectedDevIds.length})</span>
                </div>
                {outboundSelectedDevIds.map((id) => {
                  const dev = devices.find((d) => d.id === id);
                  return (
                    <div
                      key={id}
                      style={{
                        padding: 10,
                        background: 'var(--bg-input)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{dev?.product?.name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {dev?.management_code} - SN: {dev?.serial_number || 'N/A'}
                        </div>
                      </div>
                      <button
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                        onClick={() => setOutboundSelectedDevIds((prev) => prev.filter((item) => item !== id))}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}

                <button
                  className="btn btn-success btn-full"
                  onClick={handleConfirmOutbound}
                  disabled={loading}
                >
                  {loading ? 'Đang xác nhận...' : '✓ Xác nhận xuất kho'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 4: BẢO HÀNH ================= */}
        {activeTab === 'warranty' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-title">
                <span>Hồ sơ bảo hành 2 phía ({warrantyCases.length})</span>
                <button
                  className="btn btn-primary"
                  style={{ padding: '6px 14px', minHeight: 34, fontSize: '0.85rem' }}
                  onClick={() => setIntakeModalOpen(true)}
                >
                  + Tiếp nhận mới
                </button>
              </div>

              {/* Status Filters */}
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                {[
                  { key: 'ALL', label: 'Tất cả' },
                  { key: 'RECEIVED_CUSTOMER', label: 'Tiếp nhận' },
                  { key: 'SENT_SUPPLIER', label: 'Đang gửi NCC' },
                  { key: 'RECEIVED_FROM_SUPPLIER', label: 'Đã nhận về' },
                  { key: 'RESOLVED_WAITING_RETURN', label: 'Chờ trả khách' },
                  { key: 'COMPLETED', label: 'Đã hoàn tất' },
                ].map((f) => (
                  <button
                    key={f.key}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-full)',
                      border: '1px solid var(--border-color)',
                      background: warrantyFilter === f.key ? 'var(--primary)' : 'var(--bg-input)',
                      color: warrantyFilter === f.key ? '#fff' : 'var(--text-secondary)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    onClick={() => setWarrantyFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Warranty Cases List */}
            {warrantyCases
              .filter((c) => warrantyFilter === 'ALL' || c.case_status === warrantyFilter)
              .map((c) => (
                <div key={c.id} className="card" style={{ borderLeft: '4px solid var(--purple)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1rem' }}>{c.code}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {c.device?.product?.name} | SN: {c.device?.serial_number || c.device?.management_code}
                      </div>
                    </div>
                    <span className="badge badge-warranty">
                      {c.case_status === 'RECEIVED_CUSTOMER' && 'Mới tiếp nhận'}
                      {c.case_status === 'SENT_SUPPLIER' && 'Đang ở TTBH/NCC'}
                      {c.case_status === 'RECEIVED_FROM_SUPPLIER' && 'Đã nhận từ NCC'}
                      {c.case_status === 'RESOLVED_WAITING_RETURN' && 'Chờ giao khách'}
                      {c.case_status === 'COMPLETED' && '✓ Hoàn tất'}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.85rem' }}>
                    <strong>Khách hàng:</strong> {c.customer?.name || 'Khách lẻ'}{' '}
                    {c.customer?.phone ? `(${c.customer.phone})` : ''}
                  </div>

                  <div style={{ fontSize: '0.85rem', background: 'var(--bg-input)', padding: 8, borderRadius: 6 }}>
                    <div>⚠️ <strong>Lỗi báo:</strong> {c.reported_fault}</div>
                    {c.accessories_received && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        📦 Phụ kiện kèm: {c.accessories_received}
                      </div>
                    )}
                    {c.repair_outcome && (
                      <div style={{ color: 'var(--success)', marginTop: 4 }}>
                        🛠️ <strong>Kết quả:</strong> {c.repair_outcome}
                      </div>
                    )}
                  </div>

                  {/* Policy Snapshot display */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <div>
                      NCC: {c.snapshot_supplier_policy?.has_warranty ? `Đến ${c.snapshot_supplier_policy.end_date || 'N/A'}` : 'Chưa có TT'}
                    </div>
                    <div>
                      Khách: {c.snapshot_customer_policy?.has_warranty ? `Đến ${c.snapshot_customer_policy.end_date || 'N/A'}` : 'Chưa có TT'}
                    </div>
                  </div>

                  {/* Actions according to state */}
                  {c.case_status !== 'COMPLETED' && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      {c.case_status === 'RECEIVED_CUSTOMER' && (
                        <>
                          <button
                            className="btn btn-primary"
                            style={{ flex: 1, minHeight: 36, padding: '6px 10px', fontSize: '0.8rem' }}
                            onClick={() => {
                              setSelectedCase(c);
                              setSendSupplierModalOpen(true);
                            }}
                          >
                            🚀 Gửi NCC/TTBH
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ flex: 1, minHeight: 36, padding: '6px 10px', fontSize: '0.8rem' }}
                            onClick={() => {
                              setSelectedCase(c);
                              setLocalRepairModalOpen(true);
                            }}
                          >
                            🔧 Sửa tại chỗ
                          </button>
                        </>
                      )}

                      {c.case_status === 'SENT_SUPPLIER' && (
                        <>
                          <button
                            className="btn btn-primary"
                            style={{ flex: 1, minHeight: 36, padding: '6px 10px', fontSize: '0.8rem' }}
                            onClick={() => {
                              setSelectedCase(c);
                              setReceiveSupplierModalOpen(true);
                            }}
                          >
                            📥 Nhận về từ NCC
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ flex: 1, minHeight: 36, padding: '6px 10px', fontSize: '0.8rem' }}
                            onClick={() => {
                              setSelectedCase(c);
                              setReplaceDeviceModalOpen(true);
                            }}
                          >
                            🔄 Đổi SN mới
                          </button>
                        </>
                      )}

                      {c.case_status === 'RECEIVED_FROM_SUPPLIER' && (
                        <>
                          <button
                            className="btn btn-primary"
                            style={{ flex: 2, minHeight: 36, padding: '6px 10px', fontSize: '0.8rem' }}
                            onClick={() => handleTransition(c.id, 'RESOLVED_WAITING_RETURN', 'INSPECT_READY', 'Đã kiểm tra xong, chuẩn bị bàn giao')}
                          >
                            ✓ Chuyển sang chờ trả khách
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ flex: 1, minHeight: 36, padding: '6px 10px', fontSize: '0.8rem' }}
                            onClick={() => {
                              setSelectedCase(c);
                              setReplaceDeviceModalOpen(true);
                            }}
                          >
                            🔄 Đổi SN
                          </button>
                        </>
                      )}

                      {c.case_status === 'RESOLVED_WAITING_RETURN' && (
                        <button
                          className="btn btn-success btn-full"
                          style={{ minHeight: 40 }}
                          onClick={() => handleTransition(c.id, 'COMPLETED', 'DELIVER_CUSTOMER', 'Bàn giao thiết bị hoàn tất cho khách')}
                          disabled={loading}
                        >
                          🤝 Bàn giao hoàn tất cho khách
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}

        {/* ================= TAB 5: TỒN KHO & DANH SÁCH ================= */}
        {activeTab === 'inventory' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card">
              <div className="card-title">
                <span>Tổng hợp thiết bị ({devices.length})</span>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', minHeight: 32, fontSize: '0.8rem' }}
                  onClick={() => {
                    setScannerTarget('return');
                    setScannerOpen(true);
                  }}
                >
                  🔄 Thu hồi máy mượn
                </button>
              </div>
            </div>

            {devices.map((dev) => {
              const readiness = inventoryService.checkOutboundReadiness(dev);
              return (
                <div
                  key={dev.id}
                  className="card"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelectedDevice(dev);
                    setActiveTab('search');
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{dev.product?.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {dev.management_code} {dev.serial_number ? `| SN: ${dev.serial_number}` : ''}
                      </div>
                    </div>
                    {readiness.eligible ? (
                      <span className="badge badge-usable">Sẵn sàng xuất</span>
                    ) : (
                      <span className="badge badge-inspection">Chưa thể xuất</span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span className="badge badge-internal">{dev.owner_type === 'INTERNAL' ? 'Kho' : 'Khách'}</span>
                    <span className="badge badge-storage">
                      {dev.holder_type === 'INTERNAL_STORAGE' ? 'Tại kho' : 'Bên ngoài'}
                    </span>
                    <span className={`badge ${dev.technical_condition === 'USABLE' ? 'badge-usable' : 'badge-faulty'}`}>
                      {dev.technical_condition}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Return Assignment Modal */}
      {returnDevice && (
        <div className="modal-overlay" onClick={() => setReturnDevice(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Thu hồi / Nhận lại thiết bị</h3>
            <div style={{ fontSize: '0.9rem' }}>
              Thiết bị: <strong>{returnDevice.product?.name}</strong> ({returnDevice.management_code})
            </div>
            <div className="form-group">
              <label className="form-label">Tình trạng thực tế lúc nhận lại (*):</label>
              <select
                className="select"
                value={returnCondition}
                onChange={(e) => setReturnCondition(e.target.value as any)}
              >
                <option value="USABLE">Hoạt động tốt / Bình thường (USABLE)</option>
                <option value="NEEDS_INSPECTION">Nghi ngờ lỗi / Cần test kỹ (NEEDS_INSPECTION)</option>
                <option value="FAULTY">Hỏng hóc / Phát sinh lỗi (FAULTY)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Ghi chú thu hồi:</label>
              <textarea
                className="textarea"
                placeholder="Phụ kiện trả đủ, vỏ ngoài trầy xước nhẹ..."
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setReturnDevice(null)}>
                Hủy
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirmReturn} disabled={loading}>
                Xác nhận thu hồi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Intake Warranty Modal */}
      {intakeModalOpen && (
        <div className="modal-overlay" onClick={() => setIntakeModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Tiếp nhận thiết bị bảo hành</h3>
            <div className="form-group">
              <label className="form-label">Chọn thiết bị cần bảo hành (*):</label>
              <select
                className="select"
                value={intakeDeviceId}
                onChange={(e) => setIntakeDeviceId(e.target.value)}
              >
                <option value="">-- Chọn thiết bị --</option>
                {devices
                  .filter((d) => !d.active_warranty_case || d.active_warranty_case.case_status === 'COMPLETED')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.product?.name} ({d.management_code} - SN: {d.serial_number || 'N/A'})
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Mô tả lỗi khách báo (*):</label>
              <textarea
                className="textarea"
                placeholder="VD: Không lên nguồn, màn hình sọc ngang, quạt kêu to..."
                value={intakeFault}
                onChange={(e) => setIntakeFault(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phụ kiện kèm theo (nếu có):</label>
              <input
                type="text"
                className="input"
                placeholder="VD: Sạc cáp zin, túi chống sốc, chuột..."
                value={intakeAccessories}
                onChange={(e) => setIntakeAccessories(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIntakeModalOpen(false)}>
                Hủy
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleIntakeWarranty} disabled={loading}>
                {loading ? 'Đang tạo...' : 'Xác nhận tiếp nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Supplier Modal */}
      {sendSupplierModalOpen && selectedCase && (
        <div className="modal-overlay" onClick={() => setSendSupplierModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Bàn giao gửi NCC / TTBH</h3>
            <div style={{ fontSize: '0.85rem' }}>
              Hồ sơ: <strong>{selectedCase.code}</strong> - {selectedCase.device?.product?.name}
            </div>
            <div className="form-group">
              <label className="form-label">Đơn vị / Nhà cung cấp nhận bảo hành (*):</label>
              <select
                className="select"
                value={sendSupplierPartyId}
                onChange={(e) => setSendSupplierPartyId(e.target.value)}
              >
                <option value="">-- Chọn đơn vị bảo hành --</option>
                {parties.filter((p) => p.type === 'SUPPLIER').map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Ghi chú gửi hàng / Số biên nhận:</label>
              <textarea
                className="textarea"
                placeholder="Số phiếu hẹn bảo hành NCC: 12345..."
                value={sendSupplierNotes}
                onChange={(e) => setSendSupplierNotes(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setSendSupplierModalOpen(false)}>
                Hủy
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSendSupplierSubmit} disabled={loading}>
                Xác nhận gửi NCC
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local Repair Modal */}
      {localRepairModalOpen && selectedCase && (
        <div className="modal-overlay" onClick={() => setLocalRepairModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Sửa chữa / Xử lý tại chỗ</h3>
            <div style={{ fontSize: '0.85rem' }}>
              Hồ sơ: <strong>{selectedCase.code}</strong>
            </div>
            <div className="form-group">
              <label className="form-label">Ghi nhận kết quả xử lý (*):</label>
              <textarea
                className="textarea"
                placeholder="VD: Đã vệ sinh quạt gió và bôi keo tản nhiệt; máy hoạt động ổn định..."
                value={localRepairOutcome}
                onChange={(e) => setLocalRepairOutcome(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setLocalRepairModalOpen(false)}>
                Hủy
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleLocalRepairSubmit} disabled={loading}>
                Hoàn tất & Chờ trả khách
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Supplier Modal */}
      {receiveSupplierModalOpen && selectedCase && (
        <div className="modal-overlay" onClick={() => setReceiveSupplierModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Nhận thiết bị về từ NCC</h3>
            <div style={{ fontSize: '0.85rem' }}>
              Hồ sơ: <strong>{selectedCase.code}</strong>
            </div>
            <div className="form-group">
              <label className="form-label">Kết quả từ phía NCC (*):</label>
              <textarea
                className="textarea"
                placeholder="VD: NCC đã thay bàn phím mới / NCC từ chối bảo hành do vào nước..."
                value={receiveSupplierOutcome}
                onChange={(e) => setReceiveSupplierOutcome(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setReceiveSupplierModalOpen(false)}>
                Hủy
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleReceiveSupplierSubmit} disabled={loading}>
                Xác nhận nhận về kho
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace Device Modal */}
      {replaceDeviceModalOpen && selectedCase && (
        <div className="modal-overlay" onClick={() => setReplaceDeviceModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Đổi thiết bị mới (Đổi SN)</h3>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Thiết bị cũ ({selectedCase.device?.management_code}) sẽ được chuyển sang <strong>REPLACED</strong>. Thiết bị mới sẽ kế thừa quyền sở hữu.
            </div>
            <div className="form-group">
              <label className="form-label">Mã quản lý mới (*):</label>
              <input
                type="text"
                className="input"
                placeholder="VD: DEV-REPLACE-001"
                value={replaceNewCode}
                onChange={(e) => setReplaceNewCode(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Serial Number mới (nếu có):</label>
              <input
                type="text"
                className="input"
                placeholder="VD: PF4Y99B2"
                value={replaceNewSerial}
                onChange={(e) => setReplaceNewSerial(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Lý do & Chứng từ đổi máy:</label>
              <input
                type="text"
                className="input"
                value={replaceReason}
                onChange={(e) => setReplaceReason(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setReplaceDeviceModalOpen(false)}>
                Hủy
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleReplaceDeviceSubmit} disabled={loading}>
                Xác nhận đổi máy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Barcode/QR Scanner Modal */}
      <ScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleScanDetected}
        title={
          scannerTarget === 'search'
            ? 'Quét mã tra cứu'
            : scannerTarget === 'inbound'
            ? 'Quét mã nhập kho liên tục'
            : scannerTarget === 'outbound'
            ? 'Quét mã xuất kho'
            : 'Quét mã thu hồi'
        }
      />

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <button
          className={`nav-item ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Tra cứu</span>
        </button>

        <button
          className={`nav-item ${activeTab === 'inbound' ? 'active' : ''}`}
          onClick={() => setActiveTab('inbound')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          </svg>
          <span>Nhập kho</span>
        </button>

        <button
          className={`nav-item ${activeTab === 'outbound' ? 'active' : ''}`}
          onClick={() => setActiveTab('outbound')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="17 14 12 9 7 14" />
            <line x1="12" y1="9" x2="12" y2="21" />
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          </svg>
          <span>Xuất kho</span>
        </button>

        <button
          className={`nav-item ${activeTab === 'warranty' ? 'active' : ''}`}
          onClick={() => setActiveTab('warranty')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Bảo hành</span>
        </button>

        <button
          className={`nav-item ${activeTab === 'inventory' ? 'active' : ''}`}
          onClick={() => setActiveTab('inventory')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <span>Tồn kho</span>
        </button>
      </nav>
    </div>
  );
}
