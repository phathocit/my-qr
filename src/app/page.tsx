'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Device, Product, Party, WarrantyCase } from '@/types/database';
import { inventoryService } from '@/lib/inventoryService';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import ScannerModal from '@/components/ScannerModal';

type Tab = 'search' | 'inbound' | 'outbound' | 'warranty' | 'inventory';

function formatDateDisplay(dStr?: string | null): string {
  if (!dStr) return '-';
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  } catch {
    return dStr;
  }
}

function toDateInputValue(dStr?: string | null): string {
  if (!dStr) return '';
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const [isMock, setIsMock] = useState(true);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Authentication State
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginHoneypot, setLoginHoneypot] = useState('');
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  // Core Data
  const [products, setProducts] = useState<Product[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [warrantyCases, setWarrantyCases] = useState<WarrantyCase[]>([]);
  const [warrantyFilter, setWarrantyFilter] = useState<string>('ALL');

  // Inventory Group & Accordion State
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
  const [inventorySearch, setInventorySearch] = useState('');
  type InventoryFilterType = 'ALL' | 'STORAGE' | 'EXPORTED' | 'THIS_MONTH' | 'EXTERNAL' | 'WARRANTY' | 'NEEDS_INSPECTION';
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilterType>('ALL');

  // Scanner Modal State
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<'search' | 'inbound' | 'outbound' | 'warranty' | 'return' | 'replace'>('search');

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

  // Edit Warranty Modal State
  const [editWarrantyModalOpen, setEditWarrantyModalOpen] = useState(false);
  const [editWarrantyDevice, setEditWarrantyDevice] = useState<Device | null>(null);
  const [editSupplierHasWarranty, setEditSupplierHasWarranty] = useState(true);
  const [editSupplierStartDate, setEditSupplierStartDate] = useState('');
  const [editSupplierEndDate, setEditSupplierEndDate] = useState('');
  const [editSupplierNotes, setEditSupplierNotes] = useState('');
  const [editCustomerHasWarranty, setEditCustomerHasWarranty] = useState(false);
  const [editCustomerStartDate, setEditCustomerStartDate] = useState('');
  const [editCustomerEndDate, setEditCustomerEndDate] = useState('');
  const [editCustomerNotes, setEditCustomerNotes] = useState('');

  // Edit Dates Modal State
  const [editDatesModalOpen, setEditDatesModalOpen] = useState(false);
  const [editDatesDevice, setEditDatesDevice] = useState<Device | null>(null);
  const [editInboundDate, setEditInboundDate] = useState<string>('');
  const [editHasOutboundDate, setEditHasOutboundDate] = useState<boolean>(false);
  const [editOutboundDate, setEditOutboundDate] = useState<string>('');
  const [editDatesReason, setEditDatesReason] = useState<string>('');
  const [editDatesError, setEditDatesError] = useState<string>('');
  const [savingDates, setSavingDates] = useState(false);

  // Inbound Warranty Policy State
  const [inboundHasWarranty, setInboundHasWarranty] = useState(true);
  const [inboundWarrantyDuration, setInboundWarrantyDuration] = useState<number>(12);
  const [inboundWarrantyUnit, setInboundWarrantyUnit] = useState<'days' | 'months' | 'years'>('months');
  const [inboundWarrantyEndDate, setInboundWarrantyEndDate] = useState<string>('');
  const [inboundWarrantyNotes, setInboundWarrantyNotes] = useState('Chính hãng NCC');

  // Outbound Warranty Policy State
  const [outboundHasWarranty, setOutboundHasWarranty] = useState(true);
  const [outboundWarrantyDuration, setOutboundWarrantyDuration] = useState<number>(12);
  const [outboundWarrantyUnit, setOutboundWarrantyUnit] = useState<'days' | 'months' | 'years'>('months');
  const [outboundWarrantyEndDate, setOutboundWarrantyEndDate] = useState<string>('');
  const [outboundWarrantyNotes, setOutboundWarrantyNotes] = useState('Bảo hành tiêu chuẩn công ty');
  const [todayStr, setTodayStr] = useState<string>('');

  // Modal custom duration states
  const [modalSupCustomAmount, setModalSupCustomAmount] = useState<number>(6);
  const [modalSupCustomUnit, setModalSupCustomUnit] = useState<'days' | 'months' | 'years'>('months');
  const [modalCustCustomAmount, setModalCustCustomAmount] = useState<number>(6);
  const [modalCustCustomUnit, setModalCustCustomUnit] = useState<'days' | 'months' | 'years'>('months');

  // Google Sheets Sync & Observability State
  const [sheetsModalOpen, setSheetsModalOpen] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsStatus, setSheetsStatus] = useState<any>(null);

  // Export Report Modal State
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const fetchSheetsStatus = async () => {
    try {
      setSheetsLoading(true);
      const res = await fetch('/api/sync/sheets');
      const data = await res.json();
      setSheetsStatus(data);
    } catch (err: any) {
      showNotice(err?.message || 'Lỗi khi kiểm tra Google Sheets', 'error');
    } finally {
      setSheetsLoading(false);
    }
  };

  const handleSheetsAction = async (action: string) => {
    try {
      setSheetsLoading(true);
      const res = await fetch(`/api/sync/sheets?action=${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Thao tác không thành công');
      }
      showNotice(data.message || 'Thao tác thành công', 'success');
      await fetchSheetsStatus();
    } catch (err: any) {
      showNotice(err?.message || 'Lỗi đồng bộ Google Sheets', 'error');
    } finally {
      setSheetsLoading(false);
    }
  };

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
    const today = new Date().toISOString().slice(0, 10);
    setTodayStr(today);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const nextYearStr = nextYear.toISOString().slice(0, 10);
    setInboundWarrantyEndDate(nextYearStr);
    setOutboundWarrantyEndDate(nextYearStr);

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

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutSeconds > 0) return;
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
          honeypot: loginHoneypot,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        if (result.retryAfter) {
          setLockoutSeconds(Number(result.retryAfter));
        }
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
      setLoginPassword('');
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
      const clean = code.trim().toLowerCase();
      const dev = devices.find((d) => {
        const matchSn = d.serial_number?.trim().toLowerCase() === clean;
        const matchMgmt = d.management_code?.trim().toLowerCase() === clean;
        return (matchSn || matchMgmt) && (d.active_assignment || d.holder_type === 'EXTERNAL_PARTY');
      });
      if (!dev) {
        showNotice(`Mã ${code} không có lượt mượn/cấp đang mở để thu hồi`, 'error');
        return;
      }
      setReturnDevice(dev);
    } else if (scannerTarget === 'replace') {
      setReplaceNewSerial(code);
      if (!replaceNewCode) {
        setReplaceNewCode(`DEV-REP-${code.slice(-6).toUpperCase()}`);
      }
      showNotice(`Đã nhận diện Serial mới: ${code}`, 'success');
    }
  };

  // --- BATCH SCANNER HANDLER (Quét liên tục & Gom danh sách) ---
  const handleBatchDetected = (items: Array<{ code: string; photo?: string }>) => {
    if (items.length === 0) return;

    if (scannerTarget === 'inbound') {
      const currentProd = products.find((p) => p.id === inboundProductId);
      let added = 0;
      let dup = 0;
      setInboundItems((prev) => {
        const next = [...prev];
        for (const item of items) {
          const isDup = next.some(
            (i) => i.serial_number?.toLowerCase() === item.code.toLowerCase() || i.management_code.toLowerCase() === item.code.toLowerCase()
          );
          if (isDup) {
            dup++;
            continue;
          }
          next.unshift({
            product_id: inboundProductId,
            product_name: currentProd?.name || 'Sản phẩm',
            management_code: `DEV-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`,
            serial_number: item.code,
            technical_condition: inboundCondition,
            photo: item.photo,
          });
          added++;
        }
        return next;
      });
      if (dup > 0) {
        showNotice(`Đã thêm ${added} thiết bị vào phiếu nhập (${dup} mã đã trùng lặp)`, 'info');
      } else {
        showNotice(`Đã thêm ${added} thiết bị vào phiếu nhập`, 'success');
      }
    } else if (scannerTarget === 'outbound') {
      let added = 0;
      const validIds: string[] = [];
      for (const item of items) {
        const clean = item.code.trim().toLowerCase();
        const dev = devices.find(
          (d) => d.serial_number?.trim().toLowerCase() === clean || d.management_code.trim().toLowerCase() === clean
        );
        if (!dev) {
          showNotice(`Không tìm thấy thiết bị có mã ${item.code}`, 'error');
          continue;
        }
        const readiness = inventoryService.checkOutboundReadiness(dev);
        if (!readiness.eligible) {
          showNotice(`Không thể xuất ${dev.management_code}: ${readiness.reason}`, 'error');
          continue;
        }
        validIds.push(dev.id);
        added++;
      }
      setOutboundSelectedDevIds((prev) => Array.from(new Set([...prev, ...validIds])));
      if (added > 0) {
        showNotice(`Đã thêm ${added} thiết bị vào phiếu xuất`, 'success');
      }
    } else {
      // Cho search, return, replace: lấy mã đầu tiên trong danh sách quét
      const targetItem = items[0];
      handleScanDetected(targetItem.code, targetItem.photo);
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

  // --- WARRANTY POLICY HELPERS & HANDLERS ---
  const addDurationToDate = (
    baseDateStr: string,
    amount: number,
    unit: 'days' | 'months' | 'years'
  ): string => {
    const d = baseDateStr ? new Date(baseDateStr) : new Date();
    if (isNaN(d.getTime())) return '';
    if (unit === 'days') {
      d.setDate(d.getDate() + amount);
    } else if (unit === 'months') {
      d.setMonth(d.getMonth() + amount);
    } else if (unit === 'years') {
      d.setFullYear(d.getFullYear() + amount);
    }
    return d.toISOString().slice(0, 10);
  };

  const addMonthsToDate = (baseDateStr: string, months: number): string => {
    return addDurationToDate(baseDateStr, months, 'months');
  };

  const calculateDurationBetween = (startDateStr?: string | null, endDateStr?: string | null): string => {
    if (!endDateStr) return 'Không thời hạn (Vô hạn)';
    if (!startDateStr) return `Đến ngày ${endDateStr}`;
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return `Đến ngày ${endDateStr}`;

    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'Đã hết hạn';
    if (diffDays === 0) return 'Trong ngày';
    if (diffDays < 30) return `${diffDays} ngày`;
    const months = Math.round(diffDays / 30.4375);
    if (months < 12) return `${months} tháng (~${diffDays} ngày)`;
    const years = (diffDays / 365.25).toFixed(1).replace(/\.0$/, '');
    return `${years} năm (~${months} tháng)`;
  };

  const getWarrantyRemainingText = (endDateStr?: string | null, referenceDateStr?: string | null): { text: string; isExpired: boolean } => {
    if (!endDateStr) return { text: 'Không thời hạn', isExpired: false };
    if (!referenceDateStr) {
      return { text: `Đến ${endDateStr}`, isExpired: false };
    }
    const today = new Date(referenceDateStr);
    if (isNaN(today.getTime())) return { text: `Đến ${endDateStr}`, isExpired: false };
    today.setHours(0, 0, 0, 0);
    const end = new Date(endDateStr);
    if (isNaN(end.getTime())) return { text: `Đến ${endDateStr}`, isExpired: false };
    end.setHours(0, 0, 0, 0);
    const diffDays = Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { text: `Hết hạn ${Math.abs(diffDays)} ngày trước`, isExpired: true };
    if (diffDays === 0) return { text: 'Hôm nay hết hạn', isExpired: false };
    if (diffDays < 30) return { text: `Còn ${diffDays} ngày`, isExpired: false };
    const months = Math.round(diffDays / 30.4375);
    if (months < 12) return { text: `Còn ~${months} tháng`, isExpired: false };
    const years = (diffDays / 365.25).toFixed(1).replace(/\.0$/, '');
    return { text: `Còn ~${years} năm`, isExpired: false };
  };

  const openEditWarrantyModal = (dev: Device) => {
    setEditWarrantyDevice(dev);
    setEditSupplierHasWarranty(dev.supplier_warranty?.has_warranty ?? true);
    setEditSupplierStartDate(dev.supplier_warranty?.start_date || new Date().toISOString().slice(0, 10));
    setEditSupplierEndDate(dev.supplier_warranty?.end_date || '');
    setEditSupplierNotes(dev.supplier_warranty?.terms_note || 'Bảo hành chính hãng NCC');

    setEditCustomerHasWarranty(dev.customer_warranty?.has_warranty ?? (dev.owner_type === 'EXTERNAL'));
    setEditCustomerStartDate(dev.customer_warranty?.start_date || new Date().toISOString().slice(0, 10));
    setEditCustomerEndDate(dev.customer_warranty?.end_date || '');
    setEditCustomerNotes(dev.customer_warranty?.terms_note || 'Bảo hành tiêu chuẩn');

    setEditWarrantyModalOpen(true);
  };

  const handleSaveWarrantyPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editWarrantyDevice) return;
    setLoading(true);
    try {
      const res = await inventoryService.updateWarrantyPolicy({
        device_id: editWarrantyDevice.id,
        supplier_warranty: {
          has_warranty: editSupplierHasWarranty,
          start_date: editSupplierStartDate || undefined,
          end_date: editSupplierEndDate || undefined,
          terms_note: editSupplierNotes || undefined,
        },
        customer_warranty: {
          has_warranty: editCustomerHasWarranty,
          start_date: editCustomerStartDate || undefined,
          end_date: editCustomerEndDate || undefined,
          terms_note: editCustomerNotes || undefined,
        },
      });
      showNotice(res.message, 'success');
      setEditWarrantyModalOpen(false);
      await refreshData();
      if (selectedDevice && selectedDevice.id === editWarrantyDevice.id) {
        setSelectedDevice((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            supplier_warranty: {
              id: prev.supplier_warranty?.id || `w-sup-${Date.now()}`,
              device_id: prev.id,
              policy_type: 'SUPPLIER_POLICY',
              source_event_type: 'MANUAL_OVERRIDE',
              source_event_id: prev.id,
              has_warranty: editSupplierHasWarranty,
              start_date: editSupplierStartDate || null,
              end_date: editSupplierEndDate || null,
              terms_note: editSupplierNotes || null,
              created_at: prev.supplier_warranty?.created_at || new Date().toISOString(),
            },
            customer_warranty: {
              id: prev.customer_warranty?.id || `w-cus-${Date.now()}`,
              device_id: prev.id,
              policy_type: 'CUSTOMER_POLICY',
              source_event_type: 'MANUAL_OVERRIDE',
              source_event_id: prev.id,
              has_warranty: editCustomerHasWarranty,
              start_date: editCustomerStartDate || null,
              end_date: editCustomerEndDate || null,
              terms_note: editCustomerNotes || null,
              created_at: prev.customer_warranty?.created_at || new Date().toISOString(),
            },
          };
        });
      }
    } catch (err: any) {
      showNotice(err.message || 'Lỗi khi cập nhật chính sách bảo hành', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openEditDatesModal = (dev: Device) => {
    setEditDatesDevice(dev);
    const currentIn = dev.inbound_date || dev.inbound_receipt?.received_date || dev.created_at;
    setEditInboundDate(toDateInputValue(currentIn) || new Date().toISOString().slice(0, 10));

    const currentOut = dev.outbound_date;
    if (currentOut) {
      setEditHasOutboundDate(true);
      setEditOutboundDate(toDateInputValue(currentOut));
    } else {
      setEditHasOutboundDate(false);
      setEditOutboundDate(new Date().toISOString().slice(0, 10));
    }

    setEditDatesReason('');
    setEditDatesError('');
    setEditDatesModalOpen(true);
  };

  const handleSaveDeviceDates = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDatesDevice) return;
    if (!editDatesReason.trim() || editDatesReason.trim().length < 3) {
      setEditDatesError('Vui lòng nhập lý do điều chỉnh ngày nhập / xuất kho (bắt buộc, tối thiểu 3 ký tự).');
      return;
    }

    setSavingDates(true);
    setEditDatesError('');
    try {
      const targetOutDate = editHasOutboundDate && editOutboundDate ? editOutboundDate : null;
      const res = await inventoryService.updateDeviceDates({
        device_id: editDatesDevice.id,
        inbound_date: editInboundDate || undefined,
        outbound_date: targetOutDate,
        reason: editDatesReason.trim(),
      });

      showNotice(res.message, 'success');
      setEditDatesModalOpen(false);

      // Kích hoạt đồng bộ Google Sheets nền
      fetch('/api/sync/sheets?action=sync_pending', { method: 'POST' }).catch(() => {});
      fetch('/api/sync/sheets?action=reconcile_model_tabs', { method: 'POST' }).catch(() => {});

      await refreshData();

      // Lấy lại dữ liệu thiết bị mới nhất từ service
      const freshDev = await inventoryService.findDeviceByCode(editDatesDevice.management_code);
      if (freshDev) {
        setSelectedDevice(freshDev);
      } else if (selectedDevice && selectedDevice.id === editDatesDevice.id) {
        setSelectedDevice((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            inbound_date: editInboundDate || prev.inbound_date,
            outbound_date: targetOutDate,
            holder_type: targetOutDate ? 'EXTERNAL_PARTY' : 'INTERNAL_STORAGE',
            owner_type: targetOutDate ? 'EXTERNAL' : 'INTERNAL',
            updated_at: new Date().toISOString(),
          };
        });
      }
    } catch (err: any) {
      setEditDatesError(err.message || 'Lỗi khi cập nhật ngày nhập / xuất kho');
    } finally {
      setSavingDates(false);
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
      const todayStr = new Date().toISOString().slice(0, 10);
      const supplierWarrantyPayload = inboundHasWarranty
        ? {
            has_warranty: true,
            start_date: todayStr,
            end_date: inboundWarrantyEndDate ? inboundWarrantyEndDate : undefined,
            terms_note: inboundWarrantyNotes || undefined,
          }
        : undefined;

      const res = await inventoryService.confirmInboundReceipt({
        supplier_id: inboundSupplierId,
        items: inboundItems.map((item) => ({
          product_id: item.product_id,
          management_code: item.management_code,
          serial_number: item.serial_number,
          technical_condition: item.technical_condition,
          photo: item.photo,
          supplier_warranty: supplierWarrantyPayload,
        })),
      });
      showNotice(res.message, 'success');
      setInboundItems([]);
      await refreshData();
      setActiveTab('inventory');
      // Tự động kích hoạt đồng bộ Google Sheets chạy ngầm
      fetch('/api/sync/sheets?action=sync_pending', { method: 'POST' }).catch(() => {});
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
        const todayStr = new Date().toISOString().slice(0, 10);
        const customerWarrantyPayload =
          ['SALE_INDIVIDUAL', 'SALE_ORG', 'GIVE_PERMANENT'].includes(outboundType) && outboundHasWarranty
            ? {
                has_warranty: true,
                start_date: todayStr,
                end_date: outboundWarrantyEndDate ? outboundWarrantyEndDate : undefined,
                terms_note: outboundWarrantyNotes || undefined,
              }
            : undefined;

        const res = await inventoryService.confirmOutboundReceipt({
          recipient_id: outboundRecipientId,
          outbound_type: outboundType as any,
          device_ids: outboundSelectedDevIds,
          customer_warranty: customerWarrantyPayload,
        });
        showNotice(res.message, 'success');
      }
      setOutboundSelectedDevIds([]);
      await refreshData();
      setActiveTab('inventory');
      // Tự động kích hoạt đồng bộ Google Sheets chạy ngầm
      fetch('/api/sync/sheets?action=sync_pending', { method: 'POST' }).catch(() => {});
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
      // Tự động kích hoạt đồng bộ Google Sheets chạy ngầm
      fetch('/api/sync/sheets?action=sync_pending', { method: 'POST' }).catch(() => {});
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
      supplierName: string | null;
      items: Device[];
      inStorageCount: number;
      externalCount: number;
      warrantyCount: number;
      needsInspectionCount: number;
    }>();

    for (const dev of devices) {
      // Bộ lọc danh mục tồn kho & tình trạng xuất
      if (inventoryFilter === 'STORAGE' && (dev.outbound_date || dev.holder_type !== 'INTERNAL_STORAGE')) continue;
      if (inventoryFilter === 'EXPORTED' && !dev.outbound_date && dev.holder_type === 'INTERNAL_STORAGE') continue;
      if (inventoryFilter === 'THIS_MONTH') {
        const inDate = dev.inbound_date || dev.inbound_receipt?.received_date || dev.created_at;
        if (!inDate) continue;
        const d = new Date(inDate);
        const now = new Date();
        if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) continue;
      }
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
        const sup = inventoryService.findSupplierForDevice(dev, parties);
        map.set(pId, {
          productId: pId,
          productName: dev.product?.name || 'Sản phẩm khác',
          brand: dev.product?.brand || 'Khác',
          category: dev.product?.category,
          supplierName: sup?.name || null,
          items: [],
          inStorageCount: 0,
          externalCount: 0,
          warrantyCount: 0,
          needsInspectionCount: 0,
        });
      }
      const group = map.get(pId)!;
      if (!group.supplierName) {
        const sup = inventoryService.findSupplierForDevice(dev, parties);
        if (sup) group.supplierName = sup.name;
      }
      group.items.push(dev);
      if (dev.holder_type === 'INTERNAL_STORAGE') group.inStorageCount++;
      if (dev.holder_type === 'EXTERNAL_PARTY') group.externalCount++;
      if (dev.holder_type === 'SUPPLIER_WARRANTY' || dev.active_warranty_case) group.warrantyCount++;
      if (dev.technical_condition !== 'USABLE') group.needsInspectionCount++;
    }

    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  }, [devices, parties, inventorySearch, inventoryFilter]);

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

  // Xuất báo cáo tồn kho chuyên nghiệp (Excel .xls định dạng chuẩn hoặc CSV UTF-8)
  const exportInventoryReport = (formatType: 'excel' | 'csv' = 'excel') => {
    try {
      const filteredDevices = groupedInventoryModels.flatMap((g) => g.items);
      if (filteredDevices.length === 0) {
        showNotice('Không có thiết bị nào trong bộ lọc để xuất báo cáo!', 'error');
        return;
      }

      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10);
      const timeStr = today.toLocaleTimeString('vi-VN');
      const dayStr = String(today.getDate()).padStart(2, '0');
      const monthStr = String(today.getMonth() + 1).padStart(2, '0');
      const fullDateDisplay = `${dayStr}/${monthStr}/${today.getFullYear()}`;

      // Thống kê nhanh
      let inStockCount = 0;
      let exportedCount = 0;
      let usableCount = 0;
      let needsInspectionCount = 0;
      let faultyCount = 0;

      const filterLabel =
        inventoryFilter === 'ALL'
          ? 'Tất cả thiết bị'
          : inventoryFilter === 'STORAGE'
          ? 'Trong kho (Sẵn sàng)'
          : inventoryFilter === 'EXPORTED'
          ? 'Đã xuất kho'
          : inventoryFilter === 'THIS_MONTH'
          ? 'Nhập trong tháng này'
          : inventoryFilter === 'EXTERNAL'
          ? 'Đang bên ngoài (Khách / Mượn)'
          : inventoryFilter === 'WARRANTY'
          ? 'Bảo hành NCC'
          : 'Cần kiểm tra';

      filteredDevices.forEach((d) => {
        if (d.outbound_date) exportedCount++;
        else inStockCount++;

        if (d.technical_condition === 'USABLE') usableCount++;
        else if (d.technical_condition === 'NEEDS_INSPECTION') needsInspectionCount++;
        else if (d.technical_condition === 'FAULTY') faultyCount++;
      });

      if (formatType === 'excel') {
        const tableRows = filteredDevices
          .map((dev, idx) => {
            const inDate = dev.inbound_date || dev.inbound_receipt?.received_date || dev.created_at;
            const isExported = !!dev.outbound_date;
            const outStatusText = isExported
              ? 'Đã xuất kho'
              : dev.holder_type === 'EXTERNAL_PARTY'
              ? 'Đang mượn / Bàn giao'
              : 'Trong kho (Sẵn sàng)';

            const holderText =
              dev.holder_type === 'INTERNAL_STORAGE'
                ? 'Kho nội bộ'
                : dev.holder_type === 'SUPPLIER_WARRANTY'
                ? 'TTBH Nhà cung cấp'
                : dev.holder_party?.name || 'Bên ngoài';

            const ownerText = dev.owner_type === 'INTERNAL' ? 'Nội bộ' : dev.owner_party?.name || 'Khách hàng';

            const condText =
              dev.technical_condition === 'USABLE'
                ? 'Sử dụng tốt'
                : dev.technical_condition === 'NEEDS_INSPECTION'
                ? 'Cần kiểm tra'
                : 'Hỏng / Lỗi';

            const condBg =
              dev.technical_condition === 'USABLE'
                ? '#dcfce7'
                : dev.technical_condition === 'NEEDS_INSPECTION'
                ? '#fef3c7'
                : '#fee2e2';

            const condColor =
              dev.technical_condition === 'USABLE'
                ? '#15803d'
                : dev.technical_condition === 'NEEDS_INSPECTION'
                ? '#b45309'
                : '#b91c1c';

            const outBg = isExported ? '#f3e8ff' : '#dcfce7';
            const outColor = isExported ? '#7c3aed' : '#15803d';

            const supWarrantyText = dev.supplier_warranty?.has_warranty
              ? `Đến ${formatDateDisplay(dev.supplier_warranty.end_date)}`
              : 'Không';

            const cusWarrantyText = dev.customer_warranty?.has_warranty
              ? `Đến ${formatDateDisplay(dev.customer_warranty.end_date)}`
              : 'Không';

            const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';

            return `
              <tr style="background-color: ${rowBg}; height: 28px;">
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; font-size: 11pt;">${idx + 1}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; font-weight: bold; mso-number-format:'\\@'; font-size: 11pt;">${dev.management_code}</td>
                <td style="border: 1px solid #cbd5e1; text-align: left; padding: 6px 10px; font-size: 11pt; font-weight: 600;">${dev.product?.name || ''}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; font-size: 11pt;">${dev.product?.brand || ''}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; font-size: 11pt;">${dev.product?.category || ''}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; mso-number-format:'\\@'; font-family: Consolas, monospace; font-size: 11pt;">${dev.serial_number || '-'}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; color: #1d4ed8; font-weight: 600; font-size: 11pt;">${formatDateDisplay(inDate)}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; color: ${outColor}; font-weight: 600; font-size: 11pt;">${dev.outbound_date ? formatDateDisplay(dev.outbound_date) : 'Chưa xuất'}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; font-weight: 600; font-size: 10.5pt; background-color: ${outBg}; color: ${outColor};">${outStatusText}</td>
                <td style="border: 1px solid #cbd5e1; text-align: left; padding: 6px 8px; font-size: 11pt;">${holderText}</td>
                <td style="border: 1px solid #cbd5e1; text-align: left; padding: 6px 8px; font-size: 11pt;">${ownerText}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; font-weight: 600; font-size: 10.5pt; background-color: ${condBg}; color: ${condColor};">${condText}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; font-size: 11pt;">${dev.lifecycle}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; font-size: 11pt;">${supWarrantyText}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; font-size: 11pt;">${cusWarrantyText}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; mso-number-format:'\\@'; font-size: 11pt;">${dev.inbound_receipt?.code || '-'}</td>
                <td style="border: 1px solid #cbd5e1; text-align: center; padding: 6px 8px; mso-number-format:'\\@'; font-size: 11pt;">${dev.outbound_receipt?.code || '-'}</td>
              </tr>
            `;
          })
          .join('');

        const excelHtml = `
          <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
          <head>
            <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
            <!--[if gte mso 9]>
            <xml>
              <x:ExcelWorkbook>
                <x:ExcelWorksheets>
                  <x:ExcelWorksheet>
                    <x:Name>Báo Cáo Tồn Kho</x:Name>
                    <x:WorksheetOptions>
                      <x:DisplayGridlines/>
                    </x:WorksheetOptions>
                  </x:ExcelWorksheet>
                </x:ExcelWorksheets>
              </x:ExcelWorkbook>
            </xml>
            <![endif]-->
            <style>
              body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; }
              table { border-collapse: collapse; width: 100%; }
              th { background-color: #1e40af; color: #ffffff; font-weight: bold; font-size: 11pt; padding: 8px 10px; border: 1px solid #94a3b8; text-align: center; height: 35px; }
              td { font-size: 11pt; }
            </style>
          </head>
          <body>
            <table>
              <!-- Dòng 1: Banner Tiêu đề -->
              <tr>
                <td colspan="17" style="background-color: #1e3a8a; color: #ffffff; font-size: 16pt; font-weight: bold; text-align: center; padding: 14px 10px; height: 45px;">
                  BÁO CÁO TỒN KHO & THEO DÕI THIẾT BỊ CNTT
                </td>
              </tr>
              <!-- Dòng 2: Phụ đề hệ thống -->
              <tr>
                <td colspan="17" style="background-color: #f1f5f9; color: #475569; font-size: 11pt; font-style: italic; text-align: center; padding: 6px 10px; border-bottom: 1px solid #cbd5e1;">
                  Hệ thống Quản lý Thiết bị & Kho QR Code - Công ty CP Công Nghệ Á Châu
                </td>
              </tr>
              <!-- Dòng 3: Thông tin Metadata & Thống kê -->
              <tr>
                <td colspan="17" style="background-color: #f8fafc; color: #334155; font-size: 10.5pt; text-align: center; padding: 8px 10px; border-bottom: 2px solid #94a3b8;">
                  <strong>Thời gian xuất:</strong> ${timeStr} ngày ${fullDateDisplay} &nbsp;|&nbsp; 
                  <strong>Bộ lọc:</strong> ${filterLabel} &nbsp;|&nbsp; 
                  <strong>Tổng số lượng:</strong> ${filteredDevices.length} thiết bị &nbsp;|&nbsp; 
                  <strong>Trong kho:</strong> ${inStockCount} &nbsp;|&nbsp; 
                  <strong>Đã xuất:</strong> ${exportedCount}
                </td>
              </tr>
              <!-- Dòng 4: Dòng trống cách điệu -->
              <tr style="height: 12px;">
                <td colspan="17" style="border: none;"></td>
              </tr>
              <!-- Dòng 5: Tiêu đề cột -->
              <thead>
                <tr>
                  <th style="width: 50px;">STT</th>
                  <th style="width: 130px;">Mã quản lý</th>
                  <th style="width: 240px;">Tên Model / Sản phẩm</th>
                  <th style="width: 120px;">Thương hiệu</th>
                  <th style="width: 130px;">Phân loại</th>
                  <th style="width: 170px;">Số Serial (SN)</th>
                  <th style="width: 130px;">Ngày nhập kho</th>
                  <th style="width: 130px;">Ngày xuất kho</th>
                  <th style="width: 150px;">Trạng thái xuất/kho</th>
                  <th style="width: 170px;">Vị trí / Bên giữ</th>
                  <th style="width: 170px;">Chủ sở hữu</th>
                  <th style="width: 140px;">Tình trạng kỹ thuật</th>
                  <th style="width: 110px;">Vòng đời</th>
                  <th style="width: 140px;">Bảo hành NCC</th>
                  <th style="width: 140px;">Bảo hành Khách</th>
                  <th style="width: 140px;">Phiếu nhập</th>
                  <th style="width: 140px;">Phiếu xuất</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
              <!-- Dòng Tổng cộng cuối bảng -->
              <tfoot>
                <tr style="background-color: #e2e8f0; font-weight: bold; height: 35px;">
                  <td colspan="5" style="border: 1px solid #94a3b8; text-align: center; font-size: 11pt; padding: 8px;">TỔNG CỘNG THỐNG KÊ</td>
                  <td style="border: 1px solid #94a3b8; text-align: center; font-size: 11pt;">${filteredDevices.length} thiết bị</td>
                  <td colspan="2" style="border: 1px solid #94a3b8; text-align: center; font-size: 11pt; background-color: #dbeafe; color: #1e40af;">Trong kho: ${inStockCount} | Đã xuất: ${exportedCount}</td>
                  <td colspan="9" style="border: 1px solid #94a3b8; text-align: center; font-size: 11pt; background-color: #fef3c7; color: #92400e;">Sử dụng tốt: ${usableCount} | Cần kiểm tra: ${needsInspectionCount} | Hỏng: ${faultyCount}</td>
                </tr>
              </tfoot>
            </table>
          </body>
          </html>
        `;

        const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `Bao-cao-ton-kho-${dateStr}.xls`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showNotice(`Đã xuất báo cáo ${filteredDevices.length} thiết bị ra file Excel có định dạng chuyên nghiệp (.xls)!`, 'success');
        return;
      }

      // Xuất định dạng CSV
      const headers = [
        'STT',
        'Mã quản lý',
        'Tên Model',
        'Hãng sản xuất',
        'Phân loại',
        'Serial Number (SN)',
        'Ngày nhập kho',
        'Ngày xuất kho',
        'Trạng thái xuất kho',
        'Vị trí / Bên giữ',
        'Chủ sở hữu',
        'Tình trạng kỹ thuật',
        'Vòng đời',
        'Bảo hành NCC',
        'Bảo hành Khách',
        'Mã phiếu nhập',
        'Mã phiếu xuất',
      ];

      const rows = filteredDevices.map((dev, idx) => {
        const inDate = dev.inbound_date || dev.inbound_receipt?.received_date || dev.created_at;
        const outStatus = dev.outbound_date
          ? 'Đã xuất kho'
          : dev.holder_type === 'EXTERNAL_PARTY'
          ? 'Đang mượn / Bàn giao'
          : 'Chưa xuất (Trong kho)';
        const holder =
          dev.holder_type === 'INTERNAL_STORAGE'
            ? 'Kho nội bộ'
            : dev.holder_type === 'SUPPLIER_WARRANTY'
            ? 'TTBH Nhà cung cấp'
            : dev.holder_party?.name || 'Bên ngoài';
        const owner = dev.owner_type === 'INTERNAL' ? 'Nội bộ' : dev.owner_party?.name || 'Khách';
        const cond =
          dev.technical_condition === 'USABLE'
            ? 'Sử dụng tốt'
            : dev.technical_condition === 'NEEDS_INSPECTION'
            ? 'Cần kiểm tra'
            : 'Hỏng / Lỗi';

        return [
          String(idx + 1),
          dev.management_code,
          dev.product?.name || '',
          dev.product?.brand || '',
          dev.product?.category || '',
          dev.serial_number || '',
          formatDateDisplay(inDate),
          dev.outbound_date ? formatDateDisplay(dev.outbound_date) : 'Chưa xuất',
          outStatus,
          holder,
          owner,
          cond,
          dev.lifecycle,
          dev.supplier_warranty?.has_warranty ? `Đến ${dev.supplier_warranty.end_date || 'Không hạn'}` : 'Không',
          dev.customer_warranty?.has_warranty ? `Đến ${dev.customer_warranty.end_date || 'Không hạn'}` : 'Không',
          dev.inbound_receipt?.code || '',
          dev.outbound_receipt?.code || '',
        ];
      });

      const escapeCsv = (val: string) => {
        const str = String(val ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvContent =
        '\uFEFF' +
        [headers.map(escapeCsv).join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\r\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Bao-cao-ton-kho-${dateStr}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showNotice(`Đã xuất báo cáo ${filteredDevices.length} thiết bị ra file CSV thành công!`, 'success');
    } catch (err: any) {
      showNotice(err?.message || 'Lỗi khi xuất file báo cáo', 'error');
    }
  };

  const exportInventoryToCsv = () => exportInventoryReport('excel');


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
        <div className="card" style={{ maxWidth: 440, width: '100%', padding: '28px 24px', position: 'relative' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🛡️</div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0 0 6px 0' }}>Đăng Nhập Quản Trị Kho</h2>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
              <span className="env-badge success">Bảo mật đa tầng</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Chống Brute-force & Timing Attack</span>
            </div>
          </div>

          {lockoutSeconds > 0 && (
            <div
              className="toast-notice error"
              style={{
                marginBottom: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid var(--danger)',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🔒</span>
                <span>Hệ thống tạm khóa tài khoản do nhập sai nhiều lần</span>
              </div>
              <div style={{ fontSize: '0.85rem' }}>
                Thời gian mở khóa sau:{' '}
                <strong style={{ color: 'var(--danger)' }}>
                  {Math.floor(lockoutSeconds / 60)} phút {lockoutSeconds % 60} giây
                </strong>
              </div>
            </div>
          )}

          {loginError && lockoutSeconds <= 0 && (
            <div className="toast-notice error" style={{ marginBottom: 16 }}>
              ✕ {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Anti-bot Honeypot field (hidden from legitimate users) */}
            <input
              type="text"
              name="company_tax_id"
              tabIndex={-1}
              autoComplete="off"
              value={loginHoneypot}
              onChange={(e) => setLoginHoneypot(e.target.value)}
              style={{ position: 'absolute', opacity: 0, zIndex: -1, pointerEvents: 'none', width: 0, height: 0 }}
              aria-hidden="true"
            />

            <div>
              <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>Email Quản trị viên:</label>
              <input
                type="email"
                className="input"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="admin@example.com"
                autoComplete="email"
                required
                disabled={lockoutSeconds > 0}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="form-label" style={{ margin: 0 }}>Mật khẩu Quản trị:</label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: 0,
                  }}
                >
                  {showPassword ? '🙈 Ẩn' : '👁️ Hiện'}
                </button>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  disabled={lockoutSeconds > 0}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoggingIn || lockoutSeconds > 0}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '0.95rem',
                fontWeight: 600,
                marginTop: 4,
                opacity: lockoutSeconds > 0 ? 0.5 : 1,
                cursor: lockoutSeconds > 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {lockoutSeconds > 0
                ? `⏳ Tạm khóa (${lockoutSeconds}s)`
                : isLoggingIn
                ? 'Đang xác thực an toàn...'
                : '🛡️ Đăng Nhập Quản Trị'}
            </button>
          </form>

          <div style={{ marginTop: 20, textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
            🔒 Phiên làm việc được mã hóa đầu cuối với Supabase Server Auth & Rate-Limiter
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setExportModalOpen(true)}
            className="btn btn-primary"
            style={{ fontSize: '0.75rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
            title="Tải báo cáo thiết bị ra file Excel định dạng chuẩn hoặc CSV"
          >
            📊 Xuất Excel
          </button>
          <button
            onClick={() => {
              setSheetsModalOpen(true);
              fetchSheetsStatus();
            }}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
            title="Quan sát & Đồng bộ Google Sheets"
          >
            📊 Sheets
          </button>
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

      {/* Floating Notice Toast (Luôn nổi trên mọi Modal và Overlay) */}
      {notification && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            width: '92%',
            maxWidth: 480,
            pointerEvents: 'auto',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.15)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          <div
            className={`toast-notice ${notification.type}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>
                {notification.type === 'success' && '✓'}
                {notification.type === 'error' && '✕'}
                {notification.type === 'info' && 'ℹ'}
              </span>
              <span>{notification.text}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: '1.3rem',
                lineHeight: 1,
                opacity: 0.8,
                marginLeft: 12,
              }}
            >
              &times;
            </button>
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

            {/* Quick Access Inventory & Report Shortcuts */}
            <div className="card" style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>⚡</span>
                  <span>Lối tắt Báo cáo & Lọc nhanh Tồn kho:</span>
                </span>
                <button
                  onClick={() => setExportModalOpen(true)}
                  className="btn btn-primary"
                  style={{ fontSize: '0.75rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  title="Tải ngay báo cáo thiết bị ra file Excel định dạng chuẩn hoặc CSV"
                >
                  <span>📊</span>
                  <span>Xuất Excel</span>
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '4px 9px', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => {
                    setInventoryFilter('THIS_MONTH');
                    setActiveTab('inventory');
                  }}
                  title="Xem các máy nhập kho trong tháng này"
                >
                  <span>📅</span>
                  <span>Nhập tháng này</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '4px 9px', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => {
                    setInventoryFilter('STORAGE');
                    setActiveTab('inventory');
                  }}
                  title="Xem các máy còn trong kho chưa xuất"
                >
                  <span>🟢</span>
                  <span>Chưa xuất (Tại kho)</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '4px 9px', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => {
                    setInventoryFilter('EXPORTED');
                    setActiveTab('inventory');
                  }}
                  title="Xem các máy đã xuất kho"
                >
                  <span>🟣</span>
                  <span>Đã xuất kho</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '4px 9px', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => {
                    setInventoryFilter('ALL');
                    setActiveTab('inventory');
                  }}
                  title="Mở toàn bộ danh sách tồn kho theo Model"
                >
                  <span>📦</span>
                  <span>Xem toàn bộ tồn kho ({devices.length})</span>
                </button>
              </div>
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

                {/* Lịch sử Ngày Nhập / Xuất kho */}
                <div style={{ background: 'var(--bg-input)', padding: 12, borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>📅</span>
                      <span>Theo dõi Ngày Nhập / Xuất kho:</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={() => openEditDatesModal(selectedDevice)}
                      title="Sửa hoặc cập nhật ngày nhập / xuất kho kèm lý do"
                    >
                      ✏️ Sửa ngày Nhập / Xuất
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {/* Ngày Nhập */}
                    <div
                      style={{
                        background: 'rgba(59, 130, 246, 0.08)',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(59, 130, 246, 0.22)',
                      }}
                    >
                      <div style={{ fontSize: '0.72rem', color: '#93c5fd', fontWeight: 700, letterSpacing: '0.02em', marginBottom: 3 }}>
                        📥 NGÀY NHẬP KHO
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>
                        {formatDateDisplay(selectedDevice.inbound_date || selectedDevice.inbound_receipt?.received_date || selectedDevice.created_at)}
                      </div>
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 3 }}>
                        {selectedDevice.inbound_receipt?.code
                          ? `Phiếu: ${selectedDevice.inbound_receipt.code}`
                          : 'Đăng ký vào hệ thống'}
                        {selectedDevice.inbound_receipt?.supplier?.name
                          ? ` • NCC: ${selectedDevice.inbound_receipt.supplier.name}`
                          : ''}
                      </div>
                    </div>

                    {/* Ngày Xuất */}
                    <div
                      style={{
                        background: selectedDevice.outbound_date
                          ? 'rgba(168, 85, 247, 0.08)'
                          : 'rgba(34, 197, 94, 0.08)',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: selectedDevice.outbound_date
                          ? '1px solid rgba(168, 85, 247, 0.25)'
                          : '1px solid rgba(34, 197, 94, 0.22)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: selectedDevice.outbound_date ? '#c084fc' : '#86efac',
                          fontWeight: 700,
                          letterSpacing: '0.02em',
                          marginBottom: 3,
                        }}
                      >
                        📤 NGÀY XUẤT KHO
                      </div>
                      <div
                        style={{
                          fontSize: '1rem',
                          fontWeight: 700,
                          color: selectedDevice.outbound_date ? '#f8fafc' : 'var(--success)',
                        }}
                      >
                        {selectedDevice.outbound_date
                          ? formatDateDisplay(selectedDevice.outbound_date)
                          : 'Chưa xuất kho (Trong kho)'}
                      </div>
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 3 }}>
                        {selectedDevice.outbound_receipt?.code
                          ? `Phiếu: ${selectedDevice.outbound_receipt.code}`
                          : selectedDevice.active_assignment
                          ? `Đang mượn: ${selectedDevice.active_assignment.recipient_party?.name || 'Khách/NV'}`
                          : selectedDevice.owner_type === 'EXTERNAL'
                          ? `Đã bàn giao: ${selectedDevice.owner_party?.name || 'Khách'}`
                          : 'Thiết bị sẵn sàng trong kho'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2 Warranty Policies */}
                <div style={{ background: 'var(--bg-input)', padding: 12, borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Chính sách bảo hành 2 phía:</div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={() => openEditWarrantyModal(selectedDevice)}
                    >
                      ✏️ Điền / Cập nhật
                    </button>
                  </div>
                  <div style={{ fontSize: '0.8rem' }}>
                    🏭 <strong>BH Nhà cung cấp:</strong>{' '}
                    {selectedDevice.supplier_warranty?.has_warranty ? (
                      <span style={{ color: 'var(--success)', fontWeight: 500 }}>
                        Đến {selectedDevice.supplier_warranty.end_date || 'Không thời hạn'}
                        {(() => {
                          const status = getWarrantyRemainingText(selectedDevice.supplier_warranty.end_date, todayStr);
                          return (
                            <span
                              style={{
                                marginLeft: 6,
                                padding: '1px 6px',
                                borderRadius: 4,
                                fontSize: '0.72rem',
                                background: status.isExpired ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                                color: status.isExpired ? 'var(--danger)' : 'var(--success)',
                                fontWeight: 600,
                              }}
                            >
                              {status.text}
                            </span>
                          );
                        })()}
                        {selectedDevice.supplier_warranty.terms_note ? ` (${selectedDevice.supplier_warranty.terms_note})` : ''}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Chưa có thông tin</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.8rem' }}>
                    🤝 <strong>BH Khách hàng:</strong>{' '}
                    {selectedDevice.customer_warranty?.has_warranty ? (
                      <span style={{ color: 'var(--success)', fontWeight: 500 }}>
                        Đến {selectedDevice.customer_warranty.end_date || 'Không thời hạn'}
                        {(() => {
                          const status = getWarrantyRemainingText(selectedDevice.customer_warranty.end_date, todayStr);
                          return (
                            <span
                              style={{
                                marginLeft: 6,
                                padding: '1px 6px',
                                borderRadius: 4,
                                fontSize: '0.72rem',
                                background: status.isExpired ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                                color: status.isExpired ? 'var(--danger)' : 'var(--success)',
                                fontWeight: 600,
                              }}
                            >
                              {status.text}
                            </span>
                          );
                        })()}
                        {selectedDevice.customer_warranty.terms_note ? ` (${selectedDevice.customer_warranty.terms_note})` : ''}
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

              {/* Chính sách bảo hành NCC cho phiếu nhập */}
              <div style={{ background: 'var(--bg-input)', padding: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={inboundHasWarranty}
                      onChange={(e) => setInboundHasWarranty(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                    />
                    <span>🏭 Có bảo hành từ Nhà cung cấp</span>
                  </label>
                  {inboundHasWarranty && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
                      {inboundWarrantyEndDate
                        ? `⏱️ ${calculateDurationBetween(todayStr, inboundWarrantyEndDate)}`
                        : '⏱️ Không thời hạn'}
                    </span>
                  )}
                </div>

                {inboundHasWarranty && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Quick Presets */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Gợi ý nhanh:</span>
                      {[
                        { label: '7 ngày test', amount: 7, unit: 'days' as const },
                        { label: '30 ngày', amount: 30, unit: 'days' as const },
                        { label: '3 tháng', amount: 3, unit: 'months' as const },
                        { label: '6 tháng', amount: 6, unit: 'months' as const },
                        { label: '12 tháng (1N)', amount: 12, unit: 'months' as const },
                        { label: '24 tháng (2N)', amount: 24, unit: 'months' as const },
                        { label: '36 tháng (3N)', amount: 36, unit: 'months' as const },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                          onClick={() => {
                            setInboundWarrantyDuration(preset.amount);
                            setInboundWarrantyUnit(preset.unit);
                            setInboundWarrantyEndDate(addDurationToDate(new Date().toISOString().slice(0, 10), preset.amount, preset.unit));
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                        onClick={() => {
                          setInboundWarrantyEndDate('');
                        }}
                      >
                        Không hạn
                      </button>
                    </div>

                    {/* Inputs: Duration + Unit OR exact Date */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                      <div>
                        <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Tuỳ chỉnh thời lượng:</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="number"
                            min={1}
                            className="input"
                            value={inboundWarrantyDuration}
                            onChange={(e) => {
                              const val = Math.max(1, Number(e.target.value) || 1);
                              setInboundWarrantyDuration(val);
                              setInboundWarrantyEndDate(addDurationToDate(new Date().toISOString().slice(0, 10), val, inboundWarrantyUnit));
                            }}
                            style={{ padding: '6px 8px', fontSize: '0.85rem', width: 70 }}
                          />
                          <select
                            className="select"
                            value={inboundWarrantyUnit}
                            onChange={(e) => {
                              const u = e.target.value as 'days' | 'months' | 'years';
                              setInboundWarrantyUnit(u);
                              setInboundWarrantyEndDate(addDurationToDate(new Date().toISOString().slice(0, 10), inboundWarrantyDuration, u));
                            }}
                            style={{ padding: '6px 8px', fontSize: '0.85rem', flex: 1 }}
                          >
                            <option value="days">Ngày</option>
                            <option value="months">Tháng</option>
                            <option value="years">Năm</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Ngày kết thúc BH:</label>
                        <input
                          type="date"
                          className="input"
                          value={inboundWarrantyEndDate}
                          onChange={(e) => setInboundWarrantyEndDate(e.target.value)}
                          placeholder="Không giới hạn"
                          style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                        />
                      </div>

                      <div>
                        <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Ghi chú / Điều khoản NCC:</label>
                        <input
                          type="text"
                          className="input"
                          value={inboundWarrantyNotes}
                          onChange={(e) => setInboundWarrantyNotes(e.target.value)}
                          placeholder="VD: Chính hãng NCC"
                          style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                        />
                      </div>
                    </div>
                  </div>
                )}
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

              {/* Chính sách bảo hành Khách hàng khi xuất bán / cấp */}
              {['SALE_INDIVIDUAL', 'SALE_ORG', 'GIVE_PERMANENT'].includes(outboundType) && (
                <div style={{ background: 'var(--bg-input)', padding: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={outboundHasWarranty}
                        onChange={(e) => setOutboundHasWarranty(e.target.checked)}
                        style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                      />
                      <span>🤝 Cam kết bảo hành cho khách hàng</span>
                    </label>
                    {outboundHasWarranty && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
                        {outboundWarrantyEndDate
                          ? `⏱️ ${calculateDurationBetween(todayStr, outboundWarrantyEndDate)}`
                          : '⏱️ Không thời hạn'}
                      </span>
                    )}
                  </div>

                  {outboundHasWarranty && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Quick Presets */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Gợi ý nhanh:</span>
                        {[
                          { label: '7 ngày test', amount: 7, unit: 'days' as const },
                          { label: '30 ngày', amount: 30, unit: 'days' as const },
                          { label: '3 tháng', amount: 3, unit: 'months' as const },
                          { label: '6 tháng', amount: 6, unit: 'months' as const },
                          { label: '12 tháng (1N)', amount: 12, unit: 'months' as const },
                          { label: '24 tháng (2N)', amount: 24, unit: 'months' as const },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                            onClick={() => {
                              setOutboundWarrantyDuration(preset.amount);
                              setOutboundWarrantyUnit(preset.unit);
                              setOutboundWarrantyEndDate(addDurationToDate(new Date().toISOString().slice(0, 10), preset.amount, preset.unit));
                            }}
                          >
                            {preset.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                          onClick={() => {
                            setOutboundWarrantyEndDate('');
                          }}
                        >
                          Không hạn
                        </button>
                      </div>

                      {/* Inputs: Duration + Unit OR exact Date */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Tuỳ chỉnh thời lượng:</label>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input
                              type="number"
                              min={1}
                              className="input"
                              value={outboundWarrantyDuration}
                              onChange={(e) => {
                                const val = Math.max(1, Number(e.target.value) || 1);
                                setOutboundWarrantyDuration(val);
                                setOutboundWarrantyEndDate(addDurationToDate(new Date().toISOString().slice(0, 10), val, outboundWarrantyUnit));
                              }}
                              style={{ padding: '6px 8px', fontSize: '0.85rem', width: 70 }}
                            />
                            <select
                              className="select"
                              value={outboundWarrantyUnit}
                              onChange={(e) => {
                                const u = e.target.value as 'days' | 'months' | 'years';
                                setOutboundWarrantyUnit(u);
                                setOutboundWarrantyEndDate(addDurationToDate(new Date().toISOString().slice(0, 10), outboundWarrantyDuration, u));
                              }}
                              style={{ padding: '6px 8px', fontSize: '0.85rem', flex: 1 }}
                            >
                              <option value="days">Ngày</option>
                              <option value="months">Tháng</option>
                              <option value="years">Năm</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Ngày kết thúc BH:</label>
                          <input
                            type="date"
                            className="input"
                            value={outboundWarrantyEndDate}
                            onChange={(e) => setOutboundWarrantyEndDate(e.target.value)}
                            placeholder="Không giới hạn"
                            style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                          />
                        </div>

                        <div>
                          <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Ghi chú / Tiêu chuẩn BH:</label>
                          <input
                            type="text"
                            className="input"
                            value={outboundWarrantyNotes}
                            onChange={(e) => setOutboundWarrantyNotes(e.target.value)}
                            placeholder="VD: 1 đổi 1 trong 30 ngày"
                            style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
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
                              const matchedSup = inventoryService.findSupplierForDevice(c.device, parties);
                              if (matchedSup) {
                                setSendSupplierPartyId(matchedSup.id);
                              } else {
                                const sup = parties.find((p) => p.type === 'SUPPLIER');
                                if (sup) setSendSupplierPartyId(sup.id);
                              }
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
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', minHeight: 32, fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    onClick={() => setExportModalOpen(true)}
                    title="Tải toàn bộ danh sách tồn kho ra file Excel định dạng chuẩn hoặc CSV"
                  >
                    <span>📊</span>
                    <span>Xuất Excel</span>
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 10px', minHeight: 32, fontSize: '0.78rem' }}
                    onClick={() => {
                      const allOpen = groupedInventoryModels.every((g) => expandedModels[g.productId]);
                      handleToggleAllModels(!allOpen);
                    }}
                  >
                    {groupedInventoryModels.every((g) => expandedModels[g.productId]) ? '▲ Thu gọn' : '▼ Mở rộng'}
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

              {/* Tìm kiếm & Lọc nhanh theo Ngày & Tình trạng xuất kho */}
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  placeholder="🔍 Lọc theo tên model, hãng, số serial hoặc mã QL..."
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  style={{ height: 38, fontSize: '0.85rem' }}
                />

                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                  {(() => {
                    const storageCount = devices.filter((d) => !d.outbound_date && d.holder_type === 'INTERNAL_STORAGE').length;
                    const exportedCount = devices.filter((d) => !!d.outbound_date || d.holder_type !== 'INTERNAL_STORAGE').length;
                    const now = new Date();
                    const thisMonthCount = devices.filter((d) => {
                      const inDate = d.inbound_date || d.inbound_receipt?.received_date || d.created_at;
                      if (!inDate) return false;
                      const dt = new Date(inDate);
                      return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
                    }).length;
                    const externalCount = devices.filter((d) => d.holder_type === 'EXTERNAL_PARTY').length;
                    const warrantyCount = devices.filter((d) => d.holder_type === 'SUPPLIER_WARRANTY' || !!d.active_warranty_case).length;
                    const faultyCount = devices.filter((d) => d.technical_condition !== 'USABLE').length;

                    return [
                      { key: 'ALL', label: `Tất cả (${devices.length})` },
                      { key: 'STORAGE', label: `🟢 Chưa xuất (${storageCount})` },
                      { key: 'EXPORTED', label: `🟣 Đã xuất (${exportedCount})` },
                      { key: 'THIS_MONTH', label: `📅 Nhập tháng này (${thisMonthCount})` },
                      { key: 'EXTERNAL', label: `🟡 Đang mượn / Khách (${externalCount})` },
                      { key: 'WARRANTY', label: `🛠️ Đang bảo hành (${warrantyCount})` },
                      { key: 'NEEDS_INSPECTION', label: `🔴 Cần kiểm tra / Lỗi (${faultyCount})` },
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
                          transition: 'all 0.15s ease',
                        }}
                        onClick={() => setInventoryFilter(f.key as any)}
                      >
                        {f.label}
                      </button>
                    ));
                  })()}
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
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
                              <span className="badge badge-internal">{group.brand}</span>
                              {group.category && <span>• {group.category}</span>}
                              {group.supplierName && (
                                <span
                                  style={{
                                    fontSize: '0.72rem',
                                    color: '#38bdf8',
                                    background: 'rgba(56, 189, 248, 0.12)',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    border: '1px solid rgba(56, 189, 248, 0.3)',
                                    fontWeight: 600,
                                  }}
                                >
                                  🏢 NCC: {group.supplierName}
                                </span>
                              )}
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
                                    {/* Ngày nhập / xuất kho */}
                                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '0.73rem', marginTop: 3 }}>
                                      <span style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                        📥 Nhập: <strong style={{ color: '#f8fafc' }}>{formatDateDisplay(dev.inbound_date || dev.inbound_receipt?.received_date || dev.created_at)}</strong>
                                      </span>
                                      <span style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                        📤 Xuất:{' '}
                                        {dev.outbound_date ? (
                                          <strong style={{ color: '#c084fc' }}>{formatDateDisplay(dev.outbound_date)}</strong>
                                        ) : (
                                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>Chưa xuất</span>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Nút hành động */}
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '4px 8px', minHeight: 28, fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: 3 }}
                                    onClick={() => openEditDatesModal(dev)}
                                    title="Sửa ngày nhập / xuất kho kèm lý do"
                                  >
                                    ✏️ Sửa ngày
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '4px 10px', minHeight: 28, fontSize: '0.74rem' }}
                                    onClick={() => {
                                      setSelectedDevice(dev);
                                      setActiveTab('search');
                                    }}
                                  >
                                    🔍 Tra cứu
                                  </button>
                                </div>
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
      {sendSupplierModalOpen && selectedCase && (() => {
        const matchedSup = inventoryService.findSupplierForDevice(selectedCase.device, parties) || parties.find((p) => p.id === sendSupplierPartyId) || parties.find((p) => p.type === 'SUPPLIER');
        const supplierName = matchedSup?.name || 'Nhà phân phối / TTBH chính hãng';

        return (
          <div className="modal-overlay" onClick={() => setSendSupplierModalOpen(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Bàn giao gửi NCC / TTBH</h3>
              <div style={{ fontSize: '0.85rem' }}>
                Hồ sơ: <strong>{selectedCase.code}</strong> - {selectedCase.device?.product?.name}
              </div>
              <div className="form-group" style={{ marginTop: 10 }}>
                <label className="form-label">Đơn vị / Nhà cung cấp bảo hành (*):</label>
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#93c5fd' }}>
                      🏢 {supplierName}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      Cố định tự động theo phân phối model {selectedCase.device?.product?.brand} ({selectedCase.device?.product?.name})
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      background: 'var(--primary)',
                      color: '#fff',
                      padding: '3px 8px',
                      borderRadius: 10,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    🔒 Đã khóa NCC
                  </span>
                </div>
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
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    if (matchedSup && !sendSupplierPartyId) {
                      setSendSupplierPartyId(matchedSup.id);
                    }
                    handleSendSupplierSubmit();
                  }}
                  disabled={loading}
                >
                  Xác nhận gửi NCC
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="VD: CN-DELL-NEW-99 hoặc bấm Quét"
                  value={replaceNewSerial}
                  onChange={(e) => setReplaceNewSerial(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                  onClick={() => {
                    setScannerTarget('replace');
                    setScannerOpen(true);
                  }}
                  title="Quét mã vạch / QR Serial mới"
                >
                  📷 Quét
                </button>
              </div>
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

      {/* Edit Warranty Policy Modal */}
      {editWarrantyModalOpen && editWarrantyDevice && (
        <div className="modal-overlay" onClick={() => setEditWarrantyModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Cập nhật chính sách bảo hành 2 phía</h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Mã thiết bị: <strong style={{ color: 'var(--text-main)' }}>{editWarrantyDevice.management_code}</strong>
                  {editWarrantyDevice.serial_number ? ` (SN: ${editWarrantyDevice.serial_number})` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditWarrantyModalOpen(false)}
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

            <form onSubmit={handleSaveWarrantyPolicy} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
              {/* 1. BH Nhà cung cấp */}
              <div
                style={{
                  background: 'var(--bg-input)',
                  padding: 14,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, margin: 0, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editSupplierHasWarranty}
                      onChange={(e) => setEditSupplierHasWarranty(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                    />
                    <span>🏭 Bảo hành Nhà cung cấp (Đầu vào)</span>
                  </label>
                  <span style={{ fontSize: '0.75rem', color: editSupplierHasWarranty ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                    {editSupplierHasWarranty ? 'Đang kích hoạt' : 'Không có BH'}
                  </span>
                </div>

                {editSupplierHasWarranty && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Ngày bắt đầu:</label>
                        <input
                          type="date"
                          className="input"
                          value={editSupplierStartDate}
                          onChange={(e) => setEditSupplierStartDate(e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem', margin: 0 }}>Ngày kết thúc:</label>
                          <span style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 600 }}>
                            {calculateDurationBetween(editSupplierStartDate, editSupplierEndDate)}
                          </span>
                        </div>
                        <input
                          type="date"
                          className="input"
                          value={editSupplierEndDate}
                          onChange={(e) => setEditSupplierEndDate(e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                        />
                      </div>
                    </div>

                    {/* Quick Presets */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Gợi ý nhanh:</span>
                      {[
                        { label: '+7 ngày (Test)', amount: 7, unit: 'days' as const },
                        { label: '+30 ngày', amount: 30, unit: 'days' as const },
                        { label: '+3 tháng', amount: 3, unit: 'months' as const },
                        { label: '+6 tháng', amount: 6, unit: 'months' as const },
                        { label: '+12 tháng (1N)', amount: 12, unit: 'months' as const },
                        { label: '+24 tháng (2N)', amount: 24, unit: 'months' as const },
                        { label: '+36 tháng (3N)', amount: 36, unit: 'months' as const },
                        { label: '+5 năm', amount: 5, unit: 'years' as const },
                      ].map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                          onClick={() => setEditSupplierEndDate(addDurationToDate(editSupplierStartDate || new Date().toISOString().slice(0, 10), p.amount, p.unit))}
                        >
                          {p.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                        onClick={() => setEditSupplierEndDate('')}
                      >
                        Không hạn
                      </button>
                    </div>

                    {/* Custom duration adder */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.04)', padding: '6px 10px', borderRadius: 'var(--radius-sm)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Tuỳ chỉnh thêm:</span>
                      <input
                        type="number"
                        min={1}
                        className="input"
                        value={modalSupCustomAmount}
                        onChange={(e) => setModalSupCustomAmount(Math.max(1, Number(e.target.value) || 1))}
                        style={{ width: 65, padding: '4px 6px', fontSize: '0.8rem' }}
                      />
                      <select
                        className="select"
                        value={modalSupCustomUnit}
                        onChange={(e) => setModalSupCustomUnit(e.target.value as any)}
                        style={{ width: 85, padding: '4px 6px', fontSize: '0.8rem' }}
                      >
                        <option value="days">Ngày</option>
                        <option value="months">Tháng</option>
                        <option value="years">Năm</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                        onClick={() => {
                          setEditSupplierEndDate(addDurationToDate(editSupplierStartDate || new Date().toISOString().slice(0, 10), modalSupCustomAmount, modalSupCustomUnit));
                        }}
                      >
                        Áp dụng
                      </button>
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Điều khoản / Ghi chú NCC:</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="VD: Chính hãng Lenovo 36 tháng"
                        value={editSupplierNotes}
                        onChange={(e) => setEditSupplierNotes(e.target.value)}
                        style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 2. BH Khách hàng */}
              <div
                style={{
                  background: 'var(--bg-input)',
                  padding: 14,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, margin: 0, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editCustomerHasWarranty}
                      onChange={(e) => setEditCustomerHasWarranty(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                    />
                    <span>🤝 Bảo hành Khách hàng (Đầu ra)</span>
                  </label>
                  <span style={{ fontSize: '0.75rem', color: editCustomerHasWarranty ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                    {editCustomerHasWarranty ? 'Đang kích hoạt' : 'Không có BH'}
                  </span>
                </div>

                {editCustomerHasWarranty && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Ngày bắt đầu:</label>
                        <input
                          type="date"
                          className="input"
                          value={editCustomerStartDate}
                          onChange={(e) => setEditCustomerStartDate(e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem', margin: 0 }}>Ngày kết thúc:</label>
                          <span style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 600 }}>
                            {calculateDurationBetween(editCustomerStartDate, editCustomerEndDate)}
                          </span>
                        </div>
                        <input
                          type="date"
                          className="input"
                          value={editCustomerEndDate}
                          onChange={(e) => setEditCustomerEndDate(e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                        />
                      </div>
                    </div>

                    {/* Quick Presets */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Gợi ý nhanh:</span>
                      {[
                        { label: '+7 ngày (Test)', amount: 7, unit: 'days' as const },
                        { label: '+30 ngày', amount: 30, unit: 'days' as const },
                        { label: '+3 tháng', amount: 3, unit: 'months' as const },
                        { label: '+6 tháng', amount: 6, unit: 'months' as const },
                        { label: '+12 tháng (1N)', amount: 12, unit: 'months' as const },
                        { label: '+24 tháng (2N)', amount: 24, unit: 'months' as const },
                        { label: '+36 tháng (3N)', amount: 36, unit: 'months' as const },
                        { label: '+5 năm', amount: 5, unit: 'years' as const },
                      ].map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                          onClick={() => setEditCustomerEndDate(addDurationToDate(editCustomerStartDate || new Date().toISOString().slice(0, 10), p.amount, p.unit))}
                        >
                          {p.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                        onClick={() => setEditCustomerEndDate('')}
                      >
                        Không hạn
                      </button>
                    </div>

                    {/* Custom duration adder */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.04)', padding: '6px 10px', borderRadius: 'var(--radius-sm)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Tuỳ chỉnh thêm:</span>
                      <input
                        type="number"
                        min={1}
                        className="input"
                        value={modalCustCustomAmount}
                        onChange={(e) => setModalCustCustomAmount(Math.max(1, Number(e.target.value) || 1))}
                        style={{ width: 65, padding: '4px 6px', fontSize: '0.8rem' }}
                      />
                      <select
                        className="select"
                        value={modalCustCustomUnit}
                        onChange={(e) => setModalCustCustomUnit(e.target.value as any)}
                        style={{ width: 85, padding: '4px 6px', fontSize: '0.8rem' }}
                      >
                        <option value="days">Ngày</option>
                        <option value="months">Tháng</option>
                        <option value="years">Năm</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                        onClick={() => {
                          setEditCustomerEndDate(addDurationToDate(editCustomerStartDate || new Date().toISOString().slice(0, 10), modalCustCustomAmount, modalCustCustomUnit));
                        }}
                      >
                        Áp dụng
                      </button>
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Điều khoản / Cam kết với khách:</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="VD: 1 đổi 1 trong 30 ngày, BH tiêu chuẩn công ty"
                        value={editCustomerNotes}
                        onChange={(e) => setEditCustomerNotes(e.target.value)}
                        style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setEditWarrantyModalOpen(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={loading}
                >
                  {loading ? 'Đang lưu...' : '💾 Lưu chính sách bảo hành'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Cập nhật Ngày Nhập / Xuất kho kèm lý do bắt buộc */}
      {editDatesModalOpen && editDatesDevice && (
        <div className="modal-overlay" onClick={() => !savingDates && setEditDatesModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>✏️</span>
                  <span>Điều chỉnh ngày Nhập / Xuất kho</span>
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Mã QL: <strong style={{ color: 'var(--text-main)' }}>{editDatesDevice.management_code}</strong>
                  {editDatesDevice.serial_number ? ` • SN: ${editDatesDevice.serial_number}` : ''}
                  {editDatesDevice.product?.name ? ` • ${editDatesDevice.product.name}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => !savingDates && setEditDatesModalOpen(false)}
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

            {/* Form */}
            <form onSubmit={handleSaveDeviceDates} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
              {/* Box Ngày Nhập */}
              <div
                style={{
                  background: 'rgba(59, 130, 246, 0.06)',
                  padding: 14,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(59, 130, 246, 0.22)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#93c5fd', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>📥</span>
                  <span>Ngày nhập kho:</span>
                </label>
                <input
                  type="date"
                  className="form-control"
                  style={{ background: 'var(--bg-card)' }}
                  value={editInboundDate}
                  onChange={(e) => setEditInboundDate(e.target.value)}
                  required
                />
                <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                  Mốc ngày thiết bị được tạo hoặc nhận vào hệ thống kho.
                </div>
              </div>

              {/* Box Ngày Xuất */}
              <div
                style={{
                  background: editHasOutboundDate ? 'rgba(168, 85, 247, 0.06)' : 'rgba(34, 197, 94, 0.06)',
                  padding: 14,
                  borderRadius: 'var(--radius-sm)',
                  border: editHasOutboundDate ? '1px solid rgba(168, 85, 247, 0.22)' : '1px solid rgba(34, 197, 94, 0.22)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: editHasOutboundDate ? '#c084fc' : '#86efac', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>📤</span>
                    <span>Ngày xuất kho:</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={editHasOutboundDate}
                      onChange={(e) => {
                        setEditHasOutboundDate(e.target.checked);
                        if (e.target.checked && !editOutboundDate) {
                          setEditOutboundDate(new Date().toISOString().slice(0, 10));
                        }
                      }}
                    />
                    <span>{editHasOutboundDate ? 'Đã xuất kho' : 'Chưa xuất kho (Trong kho)'}</span>
                  </label>
                </div>

                {editHasOutboundDate ? (
                  <div>
                    <input
                      type="date"
                      className="form-control"
                      style={{ background: 'var(--bg-card)' }}
                      value={editOutboundDate}
                      onChange={(e) => setEditOutboundDate(e.target.value)}
                      required={editHasOutboundDate}
                    />
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      Mốc ngày thiết bị rời kho (bán hàng, bàn giao hoặc cho mượn).
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--success)', fontStyle: 'italic', padding: '4px 0' }}>
                    ✓ Thiết bị đang ở trạng thái tồn kho sẵn sàng (Chưa xuất).
                  </div>
                )}
              </div>

              {/* Lý do sửa đổi - BẮT BUỘC */}
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.04)',
                  padding: 14,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>📝</span>
                  <span>Lý do điều chỉnh / sửa đổi (* Bắt buộc):</span>
                </label>
                <textarea
                  className="form-control"
                  rows={3}
                  style={{ background: 'var(--bg-card)', resize: 'vertical' }}
                  placeholder="Ghi rõ nguyên nhân sửa đổi (VD: Nhập nhầm theo hóa đơn, đối soát chứng từ giao nhận, khách hàng dời ngày lấy máy, v.v...)"
                  value={editDatesReason}
                  onChange={(e) => {
                    setEditDatesReason(e.target.value);
                    if (editDatesError) setEditDatesError('');
                  }}
                  required
                />
                <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                  🔒 Bắt buộc ghi lý do để lưu vết kiểm toán (Audit Trail) và chống sửa đổi tùy tiện.
                </div>
              </div>

              {/* Error message */}
              {editDatesError && (
                <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--danger)', borderRadius: 8, color: '#fca5a5', fontSize: '0.8rem' }}>
                  ⚠️ {editDatesError}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditDatesModalOpen(false)}
                  disabled={savingDates}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingDates || !editDatesReason.trim()}
                  style={{ minWidth: 170 }}
                >
                  {savingDates ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="spinner" style={{ width: 14, height: 14 }} />
                      Đang lưu & đồng bộ...
                    </span>
                  ) : (
                    '💾 Lưu & Đồng bộ Sheets'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Google Sheets Sync & Outbox Observability Modal */}
      {sheetsModalOpen && (
        <div className="modal-overlay" onClick={() => setSheetsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>📊 Đồng bộ Google Sheets & Hàng đợi Outbox</h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Quan sát hàng đợi đồng bộ một chiều (DB → Sheets) và đối soát dữ liệu
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSheetsModalOpen(false)}
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
              {/* Trạng thái kết nối Google Sheets */}
              <div
                style={{
                  background: 'var(--bg-input)',
                  padding: 12,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Cấu hình Google Sheets API:</span>
                  {sheetsStatus?.configured ? (
                    <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
                      ✓ Đã kết nối Service Account
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 600 }}>
                      ⚠️ Chưa cấu hình biến môi trường
                    </span>
                  )}
                </div>
                {sheetsStatus?.configured ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div>• Email: <code>{sheetsStatus.serviceAccount}</code></div>
                    <div>• Spreadsheet ID: <code>{sheetsStatus.spreadsheetId}</code></div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Cần thiết lập <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code>, <code>GOOGLE_PRIVATE_KEY</code>, và <code>GOOGLE_SHEETS_SPREADSHEET_ID</code> trong <code>.env.local</code> hoặc cài đặt Vercel.
                  </div>
                )}
              </div>

              {/* Thống kê Outbox Queue */}
              <div
                style={{
                  background: 'var(--bg-input)',
                  padding: 12,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Trạng thái hàng đợi Outbox:</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                    onClick={fetchSheetsStatus}
                    disabled={sheetsLoading}
                  >
                    🔄 Làm mới
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, textAlign: 'center' }}>
                  <div style={{ padding: '8px 4px', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      {sheetsStatus?.outboxStats?.pending || 0}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Chờ gửi</div>
                  </div>
                  <div style={{ padding: '8px 4px', background: 'rgba(59,130,246,0.1)', borderRadius: 4 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>
                      {sheetsStatus?.outboxStats?.processing || 0}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Đang xử lý</div>
                  </div>
                  <div style={{ padding: '8px 4px', background: 'rgba(34,197,94,0.1)', borderRadius: 4 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>
                      {sheetsStatus?.outboxStats?.success || 0}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Thành công</div>
                  </div>
                  <div style={{ padding: '8px 4px', background: 'rgba(234,179,8,0.1)', borderRadius: 4 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--warning)' }}>
                      {sheetsStatus?.outboxStats?.failed || 0}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Chờ retry</div>
                  </div>
                  <div style={{ padding: '8px 4px', background: 'rgba(239,68,68,0.1)', borderRadius: 4 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--danger)' }}>
                      {sheetsStatus?.outboxStats?.fatal_error || 0}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Lỗi cố định</div>
                  </div>
                </div>
              </div>

              {/* Danh sách lỗi gần nhất nếu có */}
              {sheetsStatus?.recentErrors && sheetsStatus.recentErrors.length > 0 && (
                <div
                  style={{
                    background: 'rgba(239,68,68,0.06)',
                    padding: 12,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(239,68,68,0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--danger)' }}>
                    ⚠️ Lỗi đồng bộ ghi nhận gần nhất:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
                    {sheetsStatus.recentErrors.map((err: any) => (
                      <div key={err.id} style={{ fontSize: '0.72rem', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 4 }}>
                        <strong style={{ color: 'var(--text-main)' }}>[{err.entity_type}]</strong> {err.last_error || 'Không có mô tả lỗi'}
                        <span style={{ color: 'var(--warning)', marginLeft: 6 }}>(Đã thử: {err.retry_count} lần)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '8px 6px', fontSize: '0.75rem' }}
                    onClick={() => handleSheetsAction('reconcile_catalog')}
                    disabled={sheetsLoading || !sheetsStatus?.configured}
                    title="Đối soát tab Danh mục sản phẩm"
                  >
                    📋 Tab Danh mục (GĐ 1)
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '8px 6px', fontSize: '0.75rem' }}
                    onClick={() => handleSheetsAction('reconcile_model_tabs')}
                    disabled={sheetsLoading || !sheetsStatus?.configured}
                    title="Đối soát các tab theo Model thiết bị"
                  >
                    📱 Tab Model (GĐ 2)
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '8px 6px', fontSize: '0.75rem' }}
                    onClick={() => handleSheetsAction('reconcile_warranty')}
                    disabled={sheetsLoading || !sheetsStatus?.configured}
                    title="Đối soát tab Hồ sơ Bảo hành"
                  >
                    🛡️ Tab Bảo hành (GĐ 3)
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: '9px 12px', fontSize: '0.8rem' }}
                    onClick={() => handleSheetsAction('sync_pending')}
                    disabled={sheetsLoading || !sheetsStatus?.configured}
                  >
                    🔄 Xử lý Outbox đang chờ
                  </button>
                </div>

                {sheetsStatus?.outboxStats?.failed > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: '100%', padding: '8px', fontSize: '0.8rem', color: 'var(--warning)' }}
                    onClick={() => handleSheetsAction('retry_failed')}
                    disabled={sheetsLoading || !sheetsStatus?.configured}
                  >
                    🔁 Thử lại ngay các job thất bại ({sheetsStatus.outboxStats.failed})
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Barcode/QR Scanner Modal */}
      <ScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleScanDetected}
        onBatchDetected={handleBatchDetected}
        title={
          scannerTarget === 'search'
            ? 'Quét mã tra cứu'
            : scannerTarget === 'inbound'
            ? 'Quét mã nhập kho liên tục'
            : scannerTarget === 'outbound'
            ? 'Quét mã xuất kho'
            : scannerTarget === 'replace'
            ? 'Quét Serial mới (Đổi máy 1-1)'
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
      {/* Modal Xuất Báo Cáo Tồn Kho Excel & CSV */}
      {exportModalOpen && (
        <div className="modal-overlay" onClick={() => setExportModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>📊</span>
                  <span>Xuất Báo Cáo Thiết Bị & Tồn Kho</span>
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Tải dữ liệu danh sách thiết bị về máy tính với định dạng rõ ràng, chuyên nghiệp
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExportModalOpen(false)}
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

            {/* Thông tin phạm vi trích xuất */}
            <div
              style={{
                background: 'rgba(59, 130, 246, 0.08)',
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(59, 130, 246, 0.22)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                marginTop: 6,
              }}
            >
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#93c5fd', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🎯</span>
                <span>Phạm vi dữ liệu đang lọc:</span>
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc' }}>
                {inventoryFilter === 'ALL' && 'Tất cả thiết bị'}
                {inventoryFilter === 'STORAGE' && 'Chỉ thiết bị trong kho (Sẵn sàng)'}
                {inventoryFilter === 'EXPORTED' && 'Chỉ thiết bị đã xuất kho'}
                {inventoryFilter === 'THIS_MONTH' && 'Chỉ thiết bị mới nhập trong tháng này'}
                {inventoryFilter === 'EXTERNAL' && 'Chỉ thiết bị bên ngoài (Khách / Mượn)'}
                {inventoryFilter === 'WARRANTY' && 'Chỉ thiết bị tại TTBH Nhà cung cấp'}
                {inventoryFilter === 'NEEDS_INSPECTION' && 'Chỉ thiết bị cần kiểm tra / Lỗi'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>Tổng: <strong style={{ color: '#f8fafc' }}>{groupedInventoryModels.flatMap(g => g.items).length}</strong> thiết bị</span>
                <span>• Trong kho: <strong style={{ color: '#86efac' }}>{groupedInventoryModels.flatMap(g => g.items).filter(d => !d.outbound_date).length}</strong></span>
                <span>• Đã xuất: <strong style={{ color: '#c084fc' }}>{groupedInventoryModels.flatMap(g => g.items).filter(d => !!d.outbound_date).length}</strong></span>
              </div>
            </div>

            {/* 2 Lựa chọn định dạng xuất */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Chọn định dạng file tải xuống:
              </div>

              {/* Lựa chọn 1: Excel chuyên nghiệp */}
              <div
                onClick={() => {
                  exportInventoryReport('excel');
                  setExportModalOpen(false);
                }}
                style={{
                  background: 'var(--bg-input)',
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1.5px solid var(--primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ fontSize: '2.2rem', lineHeight: 1 }}>📊</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Microsoft Excel (.xls)</span>
                    <span style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: 4, background: 'rgba(34, 197, 94, 0.18)', color: 'var(--success)', fontWeight: 600 }}>
                      Khuyên dùng
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                    ✓ Có tiêu đề báo cáo, viền khung bảng sắc nét, màu sắc phân loại trạng thái.<br/>
                    ✓ Định dạng chuẩn cột <strong>Ngày nhập / Ngày xuất kho</strong>.<br/>
                    ✓ Cột <strong>Serial Number</strong> giữ nguyên chuỗi text (không bị biến thành số mũ).<br/>
                    ✓ Có dòng tổng kết thống kê ở chân bảng.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '6px 12px', fontSize: '0.78rem', flexShrink: 0 }}
                >
                  Tải Excel
                </button>
              </div>

              {/* Lựa chọn 2: CSV tiêu chuẩn */}
              <div
                onClick={() => {
                  exportInventoryReport('csv');
                  setExportModalOpen(false);
                }}
                style={{
                  background: 'var(--bg-input)',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ fontSize: '1.8rem', lineHeight: 1 }}>📄</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    File CSV Tiêu chuẩn (.csv)
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    Dữ liệu phân tách dấu phẩy chuẩn UTF-8 có BOM (phù hợp nhập vào các phần mềm khác).
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '0.78rem', flexShrink: 0 }}
                >
                  Tải CSV
                </button>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setExportModalOpen(false)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

