'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Device, Product, Party, WarrantyCase } from '@/types/database';
import { inventoryService } from '@/lib/inventoryService';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import ScannerModal from '@/components/ScannerModal';

type Tab = 'search' | 'inbound' | 'outbound' | 'warranty' | 'inventory';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const [isMock, setIsMock] = useState(true);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Authentication State
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loginEmail, setLoginEmail] = useState('hatranduyphat2004@gmail.com');
  const [loginPassword, setLoginPassword] = useState('Admin@123456');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Core Data
  const [products, setProducts] = useState<Product[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [warrantyCases, setWarrantyCases] = useState<WarrantyCase[]>([]);
  const [warrantyFilter, setWarrantyFilter] = useState<string>('ALL');

  // Inventory Group & Accordion State
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState<'ALL' | 'STORAGE' | 'EXTERNAL' | 'WARRANTY' | 'NEEDS_INSPECTION'>('ALL');

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
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; title?: string } | null>(null);

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

  // Quick Create Modals State
  const [newProductModalOpen, setNewProductModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductBrand, setNewProductBrand] = useState('');
  const [newProductCategory, setNewProductCategory] = useState('Laptop');

  const [newPartyModalOpen, setNewPartyModalOpen] = useState(false);
  const [newPartyName, setNewPartyName] = useState('');
  const [newPartyType, setNewPartyType] = useState<Party['type']>('SUPPLIER');
  const [newPartyPhone, setNewPartyPhone] = useState('');
  const [newPartyEmail, setNewPartyEmail] = useState('');

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

      // Liên kết hồ sơ bảo hành đang mở vào từng thiết bị
      const activeCaseMap = new Map<string, WarrantyCase>();
      wcs.forEach((wc) => {
        if (wc.case_status !== 'COMPLETED') {
          if (wc.device_id) activeCaseMap.set(wc.device_id, wc);
          if (wc.replaced_by_device_id) activeCaseMap.set(wc.replaced_by_device_id, wc);
        }
      });
      const enrichedDevs = devs.map((d) => ({
        ...d,
        active_warranty_case: activeCaseMap.get(d.id) || null,
      }));

      setProducts(prods);
      setParties(pts);
      setDevices(enrichedDevs);
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
    const initAuth = async () => {
      if (isSupabaseConfigured()) {
        try {
          const supabase = createClient();
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            setCurrentUser(session.user);
            await refreshData();
          }
        } catch (e) {
          console.error('Lỗi kiểm tra session:', e);
        }
      } else {
        await refreshData();
      }
      setCheckingAuth(false);
    };
    initAuth();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Đăng nhập không thành công');
      }

      const supabase = createClient();
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: result.token_hash,
        type: 'magiclink',
      });

      if (error || !data.session) {
        throw new Error(error?.message || 'Không thể thiết lập phiên xác thực');
      }

      setCurrentUser(data.session.user);
      showNotice(`Đăng nhập thành công với quyền quản trị: ${result.email}`, 'success');
      await refreshData();
    } catch (err: any) {
      setLoginError(err.message || 'Lỗi đăng nhập');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      await supabase.auth.signOut();
    }
    setCurrentUser(null);
    setProducts([]);
    setParties([]);
    setDevices([]);
    setWarrantyCases([]);
    showNotice('Đã đăng xuất tài khoản.', 'info');
  };

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
    if (dev) {
      const activeCase = warrantyCases.find(
        (wc) => wc.case_status !== 'COMPLETED' && (wc.device_id === dev.id || wc.replaced_by_device_id === dev.id)
      );
      if (activeCase) {
        dev.active_warranty_case = activeCase;
      }
    }
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
          photo: item.photo,
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

  const handleCreateProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim() || !newProductBrand.trim()) {
      showNotice('Vui lòng nhập tên và hãng sản xuất', 'error');
      return;
    }
    setLoading(true);
    try {
      const created = await inventoryService.createProduct({
        name: newProductName.trim(),
        brand: newProductBrand.trim(),
        category: newProductCategory.trim(),
      });
      showNotice(`Đã thêm dòng sản phẩm: ${created.name}`, 'success');
      setNewProductModalOpen(false);
      setNewProductName('');
      setNewProductBrand('');
      await refreshData();
      setInboundProductId(created.id);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('row-level security') || msg.includes('42501')) {
        showNotice('Bạn chưa đăng nhập quản trị viên! Vui lòng tải lại trang và đăng nhập để thêm dữ liệu.', 'error');
      } else {
        showNotice(msg || 'Lỗi khi thêm sản phẩm', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePartySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPartyName.trim()) {
      showNotice('Vui lòng nhập tên đối tác', 'error');
      return;
    }
    setLoading(true);
    try {
      const created = await inventoryService.createParty({
        name: newPartyName.trim(),
        type: newPartyType,
        phone: newPartyPhone.trim() || undefined,
        email: newPartyEmail.trim() || undefined,
      });
      showNotice(`Đã thêm đối tác: ${created.name}`, 'success');
      setNewPartyModalOpen(false);
      setNewPartyName('');
      setNewPartyPhone('');
      setNewPartyEmail('');
      await refreshData();
      if (created.type === 'SUPPLIER') {
        setInboundSupplierId(created.id);
      } else {
        setOutboundRecipientId(created.id);
      }
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('row-level security') || msg.includes('42501')) {
        showNotice('Bạn chưa đăng nhập quản trị viên! Vui lòng tải lại trang và đăng nhập để thêm dữ liệu.', 'error');
      } else {
        showNotice(msg || 'Lỗi khi thêm đối tác', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // Nhóm thiết bị theo Model sản phẩm cho tab Tồn kho
  const groupedInventoryModels = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    const map = new Map<string, {
      productId: string;
      productName: string;
      brand: string;
      category?: string;
      items: Device[];
      inStorageCount: number;
      externalCount: number;
      warrantyCount: number;
      needsInspectionCount: number;
    }>();

    for (const dev of devices) {
      // Bộ lọc danh mục tồn kho
      if (inventoryFilter === 'STORAGE' && dev.holder_type !== 'INTERNAL_STORAGE') continue;
      if (inventoryFilter === 'EXTERNAL' && dev.holder_type !== 'EXTERNAL_PARTY') continue;
      if (inventoryFilter === 'WARRANTY' && dev.holder_type !== 'SUPPLIER_WARRANTY' && !dev.active_warranty_case) continue;
      if (inventoryFilter === 'NEEDS_INSPECTION' && dev.technical_condition === 'USABLE') continue;

      // Bộ lọc từ khóa
      if (q) {
        const nameMatch = dev.product?.name?.toLowerCase().includes(q);
        const brandMatch = dev.product?.brand?.toLowerCase().includes(q);
        const codeMatch = dev.management_code.toLowerCase().includes(q);
        const serialMatch = dev.serial_number?.toLowerCase().includes(q);
        if (!nameMatch && !brandMatch && !codeMatch && !serialMatch) continue;
      }

      const pId = dev.product_id || dev.product?.id || 'unknown';
      if (!map.has(pId)) {
        map.set(pId, {
          productId: pId,
          productName: dev.product?.name || 'Sản phẩm khác',
          brand: dev.product?.brand || 'Khác',
          category: dev.product?.category,
          items: [],
          inStorageCount: 0,
          externalCount: 0,
          warrantyCount: 0,
          needsInspectionCount: 0,
        });
      }
      const group = map.get(pId)!;
      group.items.push(dev);
      if (dev.holder_type === 'INTERNAL_STORAGE') group.inStorageCount++;
      if (dev.holder_type === 'EXTERNAL_PARTY') group.externalCount++;
      if (dev.holder_type === 'SUPPLIER_WARRANTY' || dev.active_warranty_case) group.warrantyCount++;
      if (dev.technical_condition !== 'USABLE') group.needsInspectionCount++;
    }

    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  }, [devices, inventorySearch, inventoryFilter]);

  const toggleModelExpand = (modelId: string) => {
    setExpandedModels((prev) => ({
      ...prev,
      [modelId]: !prev[modelId],
    }));
  };

  const handleToggleAllModels = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    groupedInventoryModels.forEach((g) => {
      next[g.productId] = expand;
    });
    setExpandedModels(next);
  };

  if (checkingAuth) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Đang kiểm tra kết nối hệ thống...</span>
        </div>
      </div>
    );
  }

  if (!currentUser && isSupabaseConfigured()) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 16 }}>
        <div className="card" style={{ maxWidth: 440, width: '100%', padding: '28px 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🔐</div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0 0 6px 0' }}>Đăng Nhập Quản Trị Kho</h2>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <span className="env-badge success">Supabase Cloud</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Bảo mật Row Level Security</span>
            </div>
          </div>

          {loginError && (
            <div className="toast-notice error" style={{ marginBottom: 16 }}>
              ✕ {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>Email Quản trị viên:</label>
              <input
                type="email"
                className="input"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </div>

            <div>
              <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>Mật khẩu Quản trị:</label>
              <input
                type="password"
                className="input"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoggingIn}
              style={{ width: '100%', padding: '12px', fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}
            >
              {isLoggingIn ? 'Đang xác thực bảo mật...' : 'Đăng Nhập Vào Kho'}
            </button>
          </form>

          <div style={{ marginTop: 20, padding: 12, borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <div><strong>Tài khoản quản trị viên:</strong></div>
            <div>• Email: <code>hatranduyphat2004@gmail.com</code></div>
            <div>• Mật khẩu: <code>Admin@123456</code></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-title">
          <span>📦 Quản Lý Thiết Bị CNTT</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isMock ? (
            <span className="env-badge warning">Demo Local (Mock)</span>
          ) : (
            <span className="env-badge success">Supabase Cloud</span>
          )}
          {currentUser && (
            <button
              onClick={handleLogout}
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '4px 8px' }}
              title="Đăng xuất khỏi hệ thống"
            >
              🚪 Thoát
            </button>
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

                {/* Ảnh chứng từ chụp lúc quét nhập kho */}
                {(() => {
                  const devPhoto = selectedDevice.photo_url || 
                    (selectedDevice.evidence_photos && selectedDevice.evidence_photos.length > 0
                      ? inventoryService.resolvePhotoUrl(selectedDevice.evidence_photos[0].storage_key)
                      : null);
                  if (!devPhoto) return null;
                  return (
                    <div style={{ background: 'var(--bg-input)', padding: 12, borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>📷</span>
                          <span>Ảnh chụp chứng từ lúc quét nhập kho:</span>
                        </div>
                        <span
                          style={{ fontSize: '0.75rem', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
                          onClick={() => setPreviewPhoto({ url: devPhoto, title: `Ảnh chứng từ: ${selectedDevice.management_code} (${selectedDevice.serial_number || 'Không có SN'})` })}
                        >
                          Phóng to ↗
                        </span>
                      </div>
                      <div
                        style={{
                          position: 'relative',
                          borderRadius: 'var(--radius-sm)',
                          overflow: 'hidden',
                          cursor: 'pointer',
                          border: '1px solid var(--border-color)',
                          maxHeight: 220,
                          background: '#090d16',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        onClick={() =>
                          setPreviewPhoto({
                            url: devPhoto,
                            title: `Ảnh chứng từ: ${selectedDevice.management_code} (${selectedDevice.serial_number || 'Không có SN'})`,
                          })
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={devPhoto}
                          alt="Ảnh chứng từ nhập kho"
                          style={{ width: '100%', height: 'auto', maxHeight: 220, objectFit: 'contain', display: 'block' }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 6,
                            right: 6,
                            background: 'rgba(0,0,0,0.78)',
                            color: '#fff',
                            fontSize: '0.72rem',
                            padding: '3px 8px',
                            borderRadius: 4,
                          }}
                        >
                          🔍 Bấm để xem ảnh đầy đủ
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Banner cảnh báo nếu thiết bị đang trong quy trình bảo hành */}
                {selectedDevice.active_warranty_case && (
                  <div
                    style={{
                      background: 'rgba(168,85,247,0.12)',
                      border: '1px solid var(--purple)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, color: 'var(--purple)', fontSize: '0.88rem' }}>
                        🛡️ Đang trong quy trình bảo hành
                      </span>
                      <span className="badge badge-warranty">
                        {selectedDevice.active_warranty_case.code}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      <strong>Lỗi báo:</strong> {selectedDevice.active_warranty_case.reported_fault}
                    </div>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '0.78rem', alignSelf: 'flex-start', marginTop: 4 }}
                      onClick={() => {
                        setWarrantyFilter('ALL');
                        setActiveTab('warranty');
                      }}
                    >
                      Xem hồ sơ bảo hành ➔
                    </button>
                  </div>
                )}

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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label className="form-label" style={{ margin: 0 }}>Nhà cung cấp (*):</label>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                    onClick={() => {
                      setNewPartyType('SUPPLIER');
                      setNewPartyModalOpen(true);
                    }}
                  >
                    + Thêm NCC
                  </button>
                </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label className="form-label" style={{ margin: 0 }}>Dòng sản phẩm đang quét (*):</label>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                    onClick={() => setNewProductModalOpen(true)}
                  >
                    + Thêm Model
                  </button>
                </div>
                <select
                  className="select"
                  value={inboundProductId}
                  onChange={(e) => setInboundProductId(e.target.value)}
                >
                  <option value="">-- Chọn dòng sản phẩm --</option>
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
                  <span>Danh sách thực nhận ({inboundItems.length} thiết bị)</span>
                </div>
                {/* Tổng hợp theo từng Model */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {Object.entries(
                    inboundItems.reduce((acc, item) => {
                      acc[item.product_name] = (acc[item.product_name] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>)
                  ).map(([name, count]) => (
                    <span
                      key={name}
                      style={{
                        background: 'rgba(59,130,246,0.15)',
                        border: '1px solid rgba(59,130,246,0.3)',
                        color: '#93c5fd',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: 12,
                      }}
                    >
                      📦 {name}: <strong>{count}</strong>
                    </span>
                  ))}
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
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                        {item.photo ? (
                          <div
                            onClick={() =>
                              setPreviewPhoto({
                                url: item.photo!,
                                title: `Ảnh quét: ${item.product_name} (${item.serial_number || item.management_code})`,
                              })
                            }
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 6,
                              overflow: 'hidden',
                              border: '2px solid var(--primary)',
                              cursor: 'pointer',
                              flexShrink: 0,
                              position: 'relative',
                            }}
                            title="Bấm để xem ảnh đối chiếu"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.photo}
                              alt="Thumbnail"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          </div>
                        ) : (
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 6,
                              background: 'rgba(255,255,255,0.06)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '1.2rem',
                              flexShrink: 0,
                            }}
                          >
                            📦
                          </div>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.product_name}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            SN: {item.serial_number || '(Mã tự sinh: ' + item.management_code + ')'}
                          </div>
                          {item.photo && (
                            <span style={{ fontSize: '0.68rem', color: 'var(--success)', fontWeight: 600 }}>
                              ✓ Đã chụp ảnh đối chiếu
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          fontSize: '1.2rem',
                          padding: 4,
                        }}
                        onClick={() => setInboundItems((prev) => prev.filter((_, i) => i !== idx))}
                        title="Xóa thiết bị này"
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label className="form-label" style={{ margin: 0 }}>Người nhận / Khách hàng (*):</label>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                    onClick={() => {
                      setNewPartyType('CUSTOMER_INDIVIDUAL');
                      setNewPartyModalOpen(true);
                    }}
                  >
                    + Thêm Người nhận
                  </button>
                </div>
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

        {/* ================= TAB 5: TỒN KHO & DANH SÁCH THEO MODEL (ACCORDION) ================= */}
        {activeTab === 'inventory' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Header tổng quan */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                    📦 Tồn kho theo Model sản phẩm
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Tổng cộng: <strong>{groupedInventoryModels.length}</strong> model | <strong>{devices.length}</strong> thiết bị
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 10px', minHeight: 32, fontSize: '0.78rem' }}
                    onClick={() => {
                      const allOpen = groupedInventoryModels.every((g) => expandedModels[g.productId]);
                      handleToggleAllModels(!allOpen);
                    }}
                  >
                    {groupedInventoryModels.every((g) => expandedModels[g.productId]) ? '▲ Thu gọn tất cả' : '▼ Mở rộng tất cả'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 10px', minHeight: 32, fontSize: '0.78rem' }}
                    onClick={() => {
                      setScannerTarget('return');
                      setScannerOpen(true);
                    }}
                  >
                    🔄 Thu hồi máy mượn
                  </button>
                </div>
              </div>

              {/* Tìm kiếm & Lọc nhanh */}
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  placeholder="🔍 Lọc theo tên model, hãng, số serial hoặc mã QL..."
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  style={{ height: 38, fontSize: '0.85rem' }}
                />

                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                  {[
                    { key: 'ALL', label: `Tất cả (${devices.length})` },
                    { key: 'STORAGE', label: 'Tại kho' },
                    { key: 'EXTERNAL', label: 'Đang mượn / Khách' },
                    { key: 'WARRANTY', label: 'Đang bảo hành' },
                    { key: 'NEEDS_INSPECTION', label: 'Cần kiểm tra / Lỗi' },
                  ].map((f) => (
                    <button
                      key={f.key}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-full)',
                        border: '1px solid var(--border-color)',
                        background: inventoryFilter === f.key ? 'var(--primary)' : 'var(--bg-input)',
                        color: inventoryFilter === f.key ? '#fff' : 'var(--text-secondary)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => setInventoryFilter(f.key as any)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Danh sách Accordion Model */}
            {groupedInventoryModels.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                Không tìm thấy model hoặc thiết bị nào phù hợp với bộ lọc.
              </div>
            ) : (
              groupedInventoryModels.map((group) => {
                const isExpanded = expandedModels[group.productId] ?? true;
                return (
                  <div
                    key={group.productId}
                    className="card"
                    style={{
                      padding: 0,
                      overflow: 'hidden',
                      border: isExpanded ? '1px solid rgba(59,130,246,0.5)' : '1px solid var(--border-color)',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    {/* Header Model (Accordion Title) */}
                    <div
                      style={{
                        padding: '12px 14px',
                        background: isExpanded ? 'rgba(59,130,246,0.08)' : 'var(--bg-card)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        userSelect: 'none',
                      }}
                      onClick={() => toggleModelExpand(group.productId)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              display: 'inline-block',
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                              transition: 'transform 0.2s ease',
                              fontSize: '0.8rem',
                              color: 'var(--primary)',
                            }}
                          >
                            ▶
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.98rem', color: '#f8fafc' }}>
                              {group.productName}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                              <span className="badge badge-internal">{group.brand}</span>
                              {group.category && <span>• {group.category}</span>}
                            </div>
                          </div>
                        </div>

                        {/* Tổng số Serial của Model */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                          <span
                            style={{
                              background: 'var(--primary)',
                              color: '#fff',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: 12,
                            }}
                          >
                            {group.items.length} serials
                          </span>
                        </div>
                      </div>

                      {/* Pill con số chi tiết */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: '0.73rem', paddingLeft: 20 }}>
                        <span style={{ color: 'var(--success)' }}>
                          🟢 {group.inStorageCount} tại kho
                        </span>
                        {group.externalCount > 0 && (
                          <span style={{ color: 'var(--warning)' }}>
                            🟡 {group.externalCount} khách/mượn
                          </span>
                        )}
                        {group.warrantyCount > 0 && (
                          <span style={{ color: 'var(--purple)' }}>
                            🟣 {group.warrantyCount} đang BH
                          </span>
                        )}
                        {group.needsInspectionCount > 0 && (
                          <span style={{ color: 'var(--danger)' }}>
                            🔴 {group.needsInspectionCount} cần KT/lỗi
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Danh sách các Serial của Model (Accordion Body) */}
                    {isExpanded && (
                      <div
                        style={{
                          padding: '10px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          background: 'rgba(0,0,0,0.18)',
                          borderTop: '1px solid var(--border-color)',
                        }}
                      >
                        {group.items.map((dev) => {
                          const readiness = inventoryService.checkOutboundReadiness(dev);
                          const photoUrl = dev.photo_url || 
                            (dev.evidence_photos && dev.evidence_photos.length > 0
                              ? inventoryService.resolvePhotoUrl(dev.evidence_photos[0].storage_key)
                              : null);

                          return (
                            <div
                              key={dev.id}
                              style={{
                                padding: '10px 12px',
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-sm)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                                  {/* Ảnh chụp chứng từ nếu có */}
                                  {photoUrl ? (
                                    <div
                                      onClick={() =>
                                        setPreviewPhoto({
                                          url: photoUrl,
                                          title: `Ảnh chứng từ: ${group.productName} (SN: ${dev.serial_number || dev.management_code})`,
                                        })
                                      }
                                      style={{
                                        width: 38,
                                        height: 38,
                                        borderRadius: 6,
                                        overflow: 'hidden',
                                        border: '1.5px solid var(--primary)',
                                        cursor: 'pointer',
                                        flexShrink: 0,
                                        background: '#000',
                                      }}
                                      title="Bấm để xem ảnh phóng to"
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={photoUrl}
                                        alt="Thumbnail"
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                      />
                                    </div>
                                  ) : (
                                    <div
                                      style={{
                                        width: 38,
                                        height: 38,
                                        borderRadius: 6,
                                        background: 'rgba(255,255,255,0.05)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '1rem',
                                        flexShrink: 0,
                                      }}
                                    >
                                      🏷️
                                    </div>
                                  )}

                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#93c5fd' }}>
                                      SN: {dev.serial_number || '(Không có SN)'}
                                    </div>
                                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                      Mã QL: <strong>{dev.management_code}</strong>
                                    </div>
                                  </div>
                                </div>

                                {/* Nút xem chi tiết */}
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: '4px 10px', minHeight: 28, fontSize: '0.74rem', flexShrink: 0 }}
                                  onClick={() => {
                                    setSelectedDevice(dev);
                                    setActiveTab('search');
                                  }}
                                >
                                  🔍 Tra cứu
                                </button>
                              </div>

                              {/* Badges trạng thái */}
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                <span className="badge badge-storage">
                                  {dev.holder_type === 'INTERNAL_STORAGE' && 'Tại kho'}
                                  {dev.holder_type === 'EXTERNAL_PARTY' && (dev.holder_party?.name ? `Khách: ${dev.holder_party.name}` : 'Bên ngoài')}
                                  {dev.holder_type === 'SUPPLIER_WARRANTY' && 'Tại TTBH / NCC'}
                                </span>

                                <span className={`badge ${dev.technical_condition === 'USABLE' ? 'badge-usable' : 'badge-faulty'}`}>
                                  {dev.technical_condition === 'USABLE' && 'Sử dụng tốt'}
                                  {dev.technical_condition === 'NEEDS_INSPECTION' && 'Cần kiểm tra'}
                                  {dev.technical_condition === 'FAULTY' && 'Lỗi'}
                                </span>

                                {readiness.eligible ? (
                                  <span className="badge badge-usable">Sẵn sàng xuất</span>
                                ) : (
                                  <span className="badge badge-inspection">Chưa thể xuất</span>
                                )}

                                {dev.active_warranty_case && (
                                  <span className="badge badge-warranty">
                                    Đang BH: {dev.active_warranty_case.code}
                                  </span>
                                )}

                                {dev.active_assignment && (
                                  <button
                                    className="btn btn-warning"
                                    style={{ padding: '2px 8px', minHeight: 24, fontSize: '0.72rem', marginLeft: 'auto' }}
                                    onClick={() => setReturnDevice(dev)}
                                  >
                                    Thu hồi
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
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

      {/* Quick Add Product Modal */}
      {newProductModalOpen && (
        <div className="modal-overlay" onClick={() => setNewProductModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>+ Thêm dòng sản phẩm mới</h3>
            <form onSubmit={handleCreateProductSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Tên model / thiết bị (*):</label>
                <input
                  type="text"
                  className="input"
                  placeholder="VD: Latitude 5440 hoặc MacBook Pro M3"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Hãng sản xuất (*):</label>
                <input
                  type="text"
                  className="input"
                  placeholder="VD: Dell, Apple, Lenovo, HP, Asus..."
                  value={newProductBrand}
                  onChange={(e) => setNewProductBrand(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Danh mục thiết bị:</label>
                <select
                  className="select"
                  value={newProductCategory}
                  onChange={(e) => setNewProductCategory(e.target.value)}
                >
                  <option value="Laptop">Laptop / Máy tính xách tay</option>
                  <option value="PC / Desktop">Máy tính để bàn / Mini PC</option>
                  <option value="Monitor">Màn hình hiển thị</option>
                  <option value="Accessories">Chuột, Bàn phím, Phụ kiện</option>
                  <option value="Printer">Máy in / Scanner</option>
                  <option value="Network">Thiết bị mạng / Router / Switch</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setNewProductModalOpen(false)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? 'Đang lưu...' : 'Lưu sản phẩm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Party Modal */}
      {newPartyModalOpen && (
        <div className="modal-overlay" onClick={() => setNewPartyModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
              {newPartyType === 'SUPPLIER' ? '+ Thêm Nhà Cung Cấp' : '+ Thêm Khách Hàng / Đối Tác'}
            </h3>
            <form onSubmit={handleCreatePartySubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Tên đối tác / Tổ chức (*):</label>
                <input
                  type="text"
                  className="input"
                  placeholder={newPartyType === 'SUPPLIER' ? 'VD: FPT Synnex, DGW...' : 'VD: Nguyễn Văn A hoặc Công ty ABC...'}
                  value={newPartyName}
                  onChange={(e) => setNewPartyName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Phân loại đối tác (*):</label>
                <select
                  className="select"
                  value={newPartyType}
                  onChange={(e) => setNewPartyType(e.target.value as any)}
                >
                  <option value="SUPPLIER">Nhà cung cấp (NCC)</option>
                  <option value="CUSTOMER_INDIVIDUAL">Khách hàng cá nhân</option>
                  <option value="CUSTOMER_ORG">Khách hàng doanh nghiệp / Tổ chức</option>
                  <option value="INTERNAL_MEMBER">Nhân sự nội bộ công ty</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Số điện thoại:</label>
                <input
                  type="tel"
                  className="input"
                  placeholder="VD: 0912345678"
                  value={newPartyPhone}
                  onChange={(e) => setNewPartyPhone(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email liên hệ:</label>
                <input
                  type="email"
                  className="input"
                  placeholder="VD: contact@doitac.com"
                  value={newPartyEmail}
                  onChange={(e) => setNewPartyEmail(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setNewPartyModalOpen(false)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? 'Đang lưu...' : 'Lưu đối tác'}
                </button>
              </div>
            </form>
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

      {/* Photo Preview Modal */}
      {previewPhoto && (
        <div className="modal-overlay" onClick={() => setPreviewPhoto(null)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640, padding: 18 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
                {previewPhoto.title || 'Ảnh chứng từ chụp lúc quét'}
              </h3>
              <button
                onClick={() => setPreviewPhoto(null)}
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
            <div
              style={{
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                border: '1px solid var(--border-color)',
                background: '#090d16',
                maxHeight: '70vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewPhoto.url}
                alt="Chi tiết ảnh chứng từ"
                style={{ width: '100%', height: 'auto', maxHeight: '70vh', objectFit: 'contain', display: 'block' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => setPreviewPhoto(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
