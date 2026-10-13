import { google, sheets_v4 } from 'googleapis';
import { Product, Device, WarrantyCase } from '@/types/database';

export function sanitizeCellValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  // Chống Formula Injection: nếu bắt đầu bằng =, +, -, @, \t, \r thì thêm dấu nháy đơn '
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function isGoogleSheetsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  );
}

export function normalizePrivateKey(rawKey: string): string {
  let cleaned = rawKey.trim();
  // Bỏ dấu nháy kép hoặc đơn bao quanh nếu có
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  // Thay thế ký tự \n thoát chuỗi
  cleaned = cleaned.replace(/\\n/g, '\n').replace(/\\r/g, '');

  // Trích xuất chuỗi base64 thuần túy (loại bỏ header, footer và khoảng trắng)
  const base64Body = cleaned
    .replace(/-----BEGIN[ A-Z0-9_-]+-----/g, '')
    .replace(/-----END[ A-Z0-9_-]+-----/g, '')
    .replace(/\s+/g, '');

  // Tái tạo chuẩn PKCS#8 PEM với độ dài 64 ký tự mỗi dòng
  let pem = '-----BEGIN PRIVATE KEY-----\n';
  for (let i = 0; i < base64Body.length; i += 64) {
    pem += base64Body.slice(i, i + 64) + '\n';
  }
  pem += '-----END PRIVATE KEY-----\n';

  return pem;
}

export function getSheetsClient(): { sheets: sheets_v4.Sheets; spreadsheetId: string } {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  if (!email || !rawKey || !spreadsheetId) {
    throw new Error(
      'Chưa cấu hình đầy đủ biến môi trường Google Sheets: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_SPREADSHEET_ID'
    );
  }

  // Tự động chuẩn hóa và khôi phục định dạng PEM PKCS#8 bất kể người dùng dán 1 dòng hay nhiều dòng
  const privateKey = normalizePrivateKey(rawKey);
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return { sheets: google.sheets({ version: 'v4', auth }), spreadsheetId };
}

export const CATALOG_HEADERS = [
  'model_id',
  'Tên Model / Sản phẩm',
  'Hãng sản xuất',
  'Phân loại',
  'Tên Tab kho riêng',
  'Số lượng máy đang quản lý',
  'Cập nhật lần cuối',
];

export const DEVICE_HEADERS = [
  'device_id',
  'Mã quản lý',
  'Serial Number (SN)',
  'Ngày nhập kho',
  'Ngày xuất kho',
  'Chủ sở hữu',
  'Bên đang giữ / Vị trí',
  'Tình trạng kỹ thuật',
  'Trạng thái vòng đời',
  'BH Nhà cung cấp',
  'BH Khách hàng',
  'Ảnh chứng từ',
  'Cập nhật lần cuối',
];

export const WARRANTY_HEADERS = [
  'warranty_case_id',
  'Mã hồ sơ',
  'device_id',
  'Mã quản lý thiết bị',
  'Serial Number (SN)',
  'Trạng thái hồ sơ',
  'Mô tả lỗi tiếp nhận',
  'Phụ kiện kèm theo',
  'Kết quả xử lý / Sửa chữa',
  'Mã thiết bị đổi mới (nếu có)',
  'Ảnh lỗi & chứng từ',
  'Ngày tiếp nhận',
  'Cập nhật lần cuối',
];

export function sanitizeSheetTitle(rawTitle: string): string {
  if (!rawTitle) return 'Model';
  // Lọc bỏ ký tự cấm của Google Sheets: \ / ? * [ ] : '
  let clean = rawTitle.replace(/[\\/?*[\]:']/g, '-').trim();
  // Giới hạn độ dài tối đa 30 ký tự để hiển thị tab gọn gàng
  if (clean.length > 30) {
    clean = clean.slice(0, 30).trim();
  }
  return clean || 'Model';
}

export class GoogleSheetsService {
  /**
   * Lấy danh sách các tab hiện có trong Spreadsheet
   */
  async getSpreadsheetSheets(sheets: sheets_v4.Sheets, spreadsheetId: string) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    return meta.data.sheets || [];
  }

  /**
   * Đảm bảo tab "Danh mục" tồn tại và có tiêu đề đúng chuẩn
   */
  async ensureCatalogSheet(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<number> {
    const sheetList = await this.getSpreadsheetSheets(sheets, spreadsheetId);
    const existing = sheetList.find((s) => s.properties?.title === 'Danh mục');

    if (existing && existing.properties?.sheetId !== undefined && existing.properties.sheetId !== null) {
      return existing.properties.sheetId;
    }

    // Tạo tab "Danh mục" mới
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: 'Danh mục',
                gridProperties: {
                  frozenRowCount: 1,
                },
              },
            },
          },
        ],
      },
    });

    const newSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId || 0;

    // Ghi hàng tiêu đề
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Danh mục!A1:G1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [CATALOG_HEADERS],
      },
    });

    return newSheetId;
  }

  /**
   * Đồng bộ 1 model sản phẩm vào tab "Danh mục" (Upsert theo model_id)
   */
  async syncCatalogItem(params: {
    product: Product;
    tabTitle?: string;
    activeDeviceCount: number;
  }): Promise<{ success: boolean; rowAction: 'UPDATED' | 'APPENDED'; rowIndex: number }> {
    const { sheets, spreadsheetId } = getSheetsClient();
    await this.ensureCatalogSheet(sheets, spreadsheetId);

    // Đọc cột A để tìm model_id
    const colARes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Danh mục!A:A',
    });

    const rows = colARes.data.values || [];
    let matchedRowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === params.product.id) {
        matchedRowIndex = i + 1; // 1-indexed trong Google Sheets
        break;
      }
    }

    const rowData = [
      sanitizeCellValue(params.product.id),
      sanitizeCellValue(params.product.name),
      sanitizeCellValue(params.product.brand),
      sanitizeCellValue(params.product.category || 'Chưa phân loại'),
      sanitizeCellValue(params.tabTitle || params.product.name),
      String(params.activeDeviceCount),
      new Date().toISOString(),
    ];

    if (matchedRowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Danh mục!A${matchedRowIndex}:G${matchedRowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [rowData],
        },
      });
      return { success: true, rowAction: 'UPDATED', rowIndex: matchedRowIndex };
    } else {
      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Danh mục!A:G',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [rowData],
        },
      });
      const updatedRange = appendRes.data.updates?.updatedRange || '';
      return { success: true, rowAction: 'APPENDED', rowIndex: rows.length + 1 };
    }
  }

  /**
   * Đối soát và đồng bộ toàn bộ tab "Danh mục" từ DB
   */
  async reconcileCatalog(products: Product[], devices: Device[]): Promise<{
    totalProducts: number;
    updatedCount: number;
    appendedCount: number;
  }> {
    const { sheets, spreadsheetId } = getSheetsClient();
    await this.ensureCatalogSheet(sheets, spreadsheetId);

    // Đọc toàn bộ tab Danh mục hiện tại
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Danh mục!A:G',
    });

    const existingRows = readRes.data.values || [];
    const modelRowMap = new Map<string, number>();

    for (let i = 1; i < existingRows.length; i++) {
      const rowId = existingRows[i][0];
      if (rowId) modelRowMap.set(rowId, i + 1);
    }

    let updatedCount = 0;
    let appendedCount = 0;

    const appendRows: string[][] = [];
    const updateBatches: { range: string; values: string[][] }[] = [];

    // Tính số lượng thiết bị active cho từng model
    const deviceCountMap = new Map<string, number>();
    devices.forEach((dev) => {
      if (dev.lifecycle === 'ACTIVE') {
        deviceCountMap.set(dev.product_id, (deviceCountMap.get(dev.product_id) || 0) + 1);
      }
    });

    for (const prod of products) {
      const count = deviceCountMap.get(prod.id) || 0;
      const rowData = [
        sanitizeCellValue(prod.id),
        sanitizeCellValue(prod.name),
        sanitizeCellValue(prod.brand),
        sanitizeCellValue(prod.category || 'Chưa phân loại'),
        sanitizeCellValue(prod.name),
        String(count),
        new Date().toISOString(),
      ];

      if (modelRowMap.has(prod.id)) {
        const rowIndex = modelRowMap.get(prod.id)!;
        updateBatches.push({
          range: `Danh mục!A${rowIndex}:G${rowIndex}`,
          values: [rowData],
        });
        updatedCount++;
      } else {
        appendRows.push(rowData);
        appendedCount++;
      }
    }

    // Batch update các dòng đã có
    if (updateBatches.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updateBatches,
        },
      });
    }

    // Append các dòng mới chưa có
    if (appendRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Danh mục!A:G',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: appendRows,
        },
      });
    }

    return {
      totalProducts: products.length,
      updatedCount,
      appendedCount,
    };
  }

  /**
   * Tạo hoặc tìm tab riêng cho Model sản phẩm
   */
  async ensureModelSheet(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    product: Product
  ): Promise<{ sheetId: number; tabTitle: string }> {
    const sheetList = await this.getSpreadsheetSheets(sheets, spreadsheetId);
    const baseTitle = sanitizeSheetTitle(`${product.brand} - ${product.name}`);

    // Tìm xem đã có tab trùng tên chưa
    const existing = sheetList.find((s) => s.properties?.title === baseTitle);
    if (existing && existing.properties?.sheetId !== undefined && existing.properties.sheetId !== null) {
      // Cập nhật lại hàng tiêu đề để luôn đồng bộ các cột mới (A1:M1)
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${baseTitle}'!A1:M1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [DEVICE_HEADERS],
        },
      });
      return { sheetId: existing.properties.sheetId, tabTitle: baseTitle };
    }

    // Nếu tên tab bị trùng với một tab khác không phải model này, sinh tên duy nhất
    let uniqueTitle = baseTitle;
    let counter = 2;
    while (sheetList.some((s) => s.properties?.title === uniqueTitle)) {
      uniqueTitle = sanitizeSheetTitle(`${baseTitle} (${counter++})`);
    }

    // Tạo tab mới
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: uniqueTitle,
                gridProperties: {
                  frozenRowCount: 1,
                },
              },
            },
          },
        ],
      },
    });

    const newSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;

    // Ghi hàng tiêu đề cho tab Model (A1:M1)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${uniqueTitle}'!A1:M1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [DEVICE_HEADERS],
      },
    });

    return { sheetId: newSheetId, tabTitle: uniqueTitle };
  }

  /**
   * Format dữ liệu 1 thiết bị thành 1 dòng trong Google Sheets
   */
  formatDeviceRow(device: Device, appUrl: string): string[] {
    const owner = device.owner_type === 'INTERNAL'
      ? 'Nội bộ'
      : (device.owner_party?.name || 'Khách hàng');

    const holder = device.holder_type === 'INTERNAL_STORAGE'
      ? 'Kho nội bộ'
      : device.holder_type === 'SUPPLIER_WARRANTY'
      ? 'TTBH Nhà cung cấp'
      : (device.holder_party?.name || 'Bên ngoài');

    const condition = device.technical_condition === 'USABLE'
      ? 'Sử dụng tốt'
      : device.technical_condition === 'NEEDS_INSPECTION'
      ? 'Cần kiểm tra'
      : 'Hỏng / Lỗi';

    const supW = device.supplier_warranty?.has_warranty
      ? `Đến ${device.supplier_warranty.end_date || 'Không hạn'} (${device.supplier_warranty.terms_note || 'Theo NCC'})`
      : 'Không có BH';

    const cusW = device.customer_warranty?.has_warranty
      ? `Đến ${device.customer_warranty.end_date || 'Không hạn'} (${device.customer_warranty.terms_note || 'Tiêu chuẩn'})`
      : 'Không có BH';

    // Link an toàn trỏ đến trang authenticated evidence theo sự kiện & thiết bị
    const evidenceUrl = `${appUrl}/evidence?entity_type=DEVICE_EVENT&device_id=${device.id}`;

    // Xử lý format ngày nhập kho & ngày xuất kho
    const formatD = (dStr?: string | null): string => {
      if (!dStr) return '';
      try {
        const d = new Date(dStr);
        if (isNaN(d.getTime())) return dStr;
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${day}/${month}/${d.getFullYear()}`;
      } catch {
        return dStr;
      }
    };

    const inDateVal = device.inbound_date || device.inbound_receipt?.received_date || device.inbound_receipt?.created_at || device.created_at;
    const formattedInDate = inDateVal ? formatD(inDateVal) : '';

    let formattedOutDate = 'Chưa xuất';
    if (device.outbound_date) {
      formattedOutDate = formatD(device.outbound_date);
    } else if (device.holder_type === 'EXTERNAL_PARTY' && device.active_assignment?.checkout_date) {
      formattedOutDate = formatD(device.active_assignment.checkout_date);
    }

    return [
      sanitizeCellValue(device.id),
      sanitizeCellValue(device.management_code),
      sanitizeCellValue(device.serial_number || ''),
      sanitizeCellValue(formattedInDate),
      sanitizeCellValue(formattedOutDate),
      sanitizeCellValue(owner),
      sanitizeCellValue(holder),
      sanitizeCellValue(condition),
      sanitizeCellValue(device.lifecycle),
      sanitizeCellValue(supW),
      sanitizeCellValue(cusW),
      sanitizeCellValue(evidenceUrl),
      new Date().toISOString(),
    ];
  }

  /**
   * Đồng bộ 1 thiết bị vào tab Model tương ứng (Upsert theo device_id)
   */
  async syncDeviceItem(params: {
    device: Device;
    product: Product;
    appUrl?: string;
  }): Promise<{ success: boolean; tabTitle: string; rowAction: 'UPDATED' | 'APPENDED'; rowIndex: number }> {
    const { sheets, spreadsheetId } = getSheetsClient();
    const appUrl = params.appUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const { tabTitle } = await this.ensureModelSheet(sheets, spreadsheetId, params.product);

    // Đọc cột A của tab để tìm device_id
    const colARes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabTitle}'!A:A`,
    });

    const rows = colARes.data.values || [];
    let matchedRowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === params.device.id) {
        matchedRowIndex = i + 1;
        break;
      }
    }

    const rowData = this.formatDeviceRow(params.device, appUrl);

    if (matchedRowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabTitle}'!A${matchedRowIndex}:M${matchedRowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [rowData],
        },
      });
      return { success: true, tabTitle, rowAction: 'UPDATED', rowIndex: matchedRowIndex };
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${tabTitle}'!A:M`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [rowData],
        },
      });
      return { success: true, tabTitle, rowAction: 'APPENDED', rowIndex: rows.length + 1 };
    }
  }

  /**
   * Đối soát và đồng bộ toàn bộ thiết bị theo từng tab Model
   */
  async reconcileModelTabs(
    products: Product[],
    devices: Device[],
    appUrl?: string
  ): Promise<{
    totalModels: number;
    totalDevices: number;
    updatedCount: number;
    appendedCount: number;
  }> {
    const { sheets, spreadsheetId } = getSheetsClient();
    const baseAppUrl = appUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // Nhóm devices theo product_id
    const modelDevicesMap = new Map<string, Device[]>();
    for (const dev of devices) {
      const pId = dev.product_id;
      if (!modelDevicesMap.has(pId)) modelDevicesMap.set(pId, []);
      modelDevicesMap.get(pId)!.push(dev);
    }

    let updatedCount = 0;
    let appendedCount = 0;

    for (const prod of products) {
      const devList = modelDevicesMap.get(prod.id) || [];
      if (devList.length === 0) continue;

      const { tabTitle } = await this.ensureModelSheet(sheets, spreadsheetId, prod);

      // Đọc các dòng hiện tại của tab
      const currentTabRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tabTitle}'!A:M`,
      });

      const currentRows = currentTabRes.data.values || [];
      const devRowMap = new Map<string, number>();

      for (let i = 1; i < currentRows.length; i++) {
        const dId = currentRows[i][0];
        if (dId) devRowMap.set(dId, i + 1);
      }

      const updateBatches: { range: string; values: string[][] }[] = [];
      const appendRows: string[][] = [];

      for (const dev of devList) {
        const rowData = this.formatDeviceRow(dev, baseAppUrl);

        if (devRowMap.has(dev.id)) {
          const rowIndex = devRowMap.get(dev.id)!;
          updateBatches.push({
            range: `'${tabTitle}'!A${rowIndex}:M${rowIndex}`,
            values: [rowData],
          });
          updatedCount++;
        } else {
          appendRows.push(rowData);
          appendedCount++;
        }
      }

      if (updateBatches.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: updateBatches,
          },
        });
      }

      if (appendRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${tabTitle}'!A:M`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: appendRows,
          },
        });
      }
    }

    return {
      totalModels: products.length,
      totalDevices: devices.length,
      updatedCount,
      appendedCount,
    };
  }

  /**
   * Đảm bảo tab "Bảo hành" tồn tại và có tiêu đề đúng chuẩn
   */
  async ensureWarrantySheet(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<number> {
    const sheetList = await this.getSpreadsheetSheets(sheets, spreadsheetId);
    const existing = sheetList.find((s) => s.properties?.title === 'Bảo hành');

    if (existing && existing.properties?.sheetId !== undefined && existing.properties.sheetId !== null) {
      return existing.properties.sheetId;
    }

    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: 'Bảo hành',
                gridProperties: {
                  frozenRowCount: 1,
                },
              },
            },
          },
        ],
      },
    });

    const newSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Bảo hành!A1:M1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [WARRANTY_HEADERS],
      },
    });

    return newSheetId;
  }

  /**
   * Format dữ liệu 1 hồ sơ bảo hành thành 1 dòng trong Google Sheets
   */
  formatWarrantyCaseRow(wc: WarrantyCase, appUrl: string): string[] {
    const statusMap: Record<string, string> = {
      RECEIVED_CUSTOMER: 'Tiếp nhận từ khách',
      SENT_SUPPLIER: 'Đã gửi sang TTBH NCC',
      RECEIVED_FROM_SUPPLIER: 'Đã nhận lại từ NCC',
      RESOLVED_WAITING_RETURN: 'Xử lý xong, chờ trả khách',
      COMPLETED: 'Hoàn tất ca bảo hành',
    };

    const evidenceUrl = `${appUrl}/evidence?entity_type=WARRANTY_INTAKE&entity_id=${wc.id}&device_id=${wc.device_id}`;

    return [
      sanitizeCellValue(wc.id),
      sanitizeCellValue(wc.code),
      sanitizeCellValue(wc.device_id),
      sanitizeCellValue(wc.device?.management_code || ''),
      sanitizeCellValue(wc.device?.serial_number || ''),
      sanitizeCellValue(statusMap[wc.case_status] || wc.case_status),
      sanitizeCellValue(wc.reported_fault),
      sanitizeCellValue(wc.accessories_received || 'Không có'),
      sanitizeCellValue(wc.repair_outcome || 'Đang xử lý'),
      sanitizeCellValue(wc.replaced_by_device_id || (wc.is_device_replaced ? 'Đã đổi máy mới' : 'Không')),
      sanitizeCellValue(evidenceUrl),
      wc.created_at ? new Date(wc.created_at).toLocaleString('vi-VN') : '',
      new Date().toISOString(),
    ];
  }

  /**
   * Đồng bộ 1 hồ sơ bảo hành vào tab "Bảo hành" (Upsert theo warranty_case_id)
   */
  async syncWarrantyCaseItem(params: {
    warrantyCase: WarrantyCase;
    appUrl?: string;
  }): Promise<{ success: boolean; rowAction: 'UPDATED' | 'APPENDED'; rowIndex: number }> {
    const { sheets, spreadsheetId } = getSheetsClient();
    const appUrl = params.appUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    await this.ensureWarrantySheet(sheets, spreadsheetId);

    const colARes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Bảo hành!A:A',
    });

    const rows = colARes.data.values || [];
    let matchedRowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === params.warrantyCase.id) {
        matchedRowIndex = i + 1;
        break;
      }
    }

    const rowData = this.formatWarrantyCaseRow(params.warrantyCase, appUrl);

    if (matchedRowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Bảo hành!A${matchedRowIndex}:M${matchedRowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [rowData],
        },
      });
      return { success: true, rowAction: 'UPDATED', rowIndex: matchedRowIndex };
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Bảo hành!A:M',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [rowData],
        },
      });
      return { success: true, rowAction: 'APPENDED', rowIndex: rows.length + 1 };
    }
  }

  /**
   * Đối soát và đồng bộ toàn bộ tab "Bảo hành" từ DB
   */
  async reconcileWarrantySheet(
    warrantyCases: WarrantyCase[],
    appUrl?: string
  ): Promise<{
    totalCases: number;
    updatedCount: number;
    appendedCount: number;
  }> {
    const { sheets, spreadsheetId } = getSheetsClient();
    const baseAppUrl = appUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    await this.ensureWarrantySheet(sheets, spreadsheetId);

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Bảo hành!A:M',
    });

    const existingRows = readRes.data.values || [];
    const caseRowMap = new Map<string, number>();

    for (let i = 1; i < existingRows.length; i++) {
      const rowId = existingRows[i][0];
      if (rowId) caseRowMap.set(rowId, i + 1);
    }

    let updatedCount = 0;
    let appendedCount = 0;

    const updateBatches: { range: string; values: string[][] }[] = [];
    const appendRows: string[][] = [];

    for (const wc of warrantyCases) {
      const rowData = this.formatWarrantyCaseRow(wc, baseAppUrl);

      if (caseRowMap.has(wc.id)) {
        const rowIndex = caseRowMap.get(wc.id)!;
        updateBatches.push({
          range: `Bảo hành!A${rowIndex}:M${rowIndex}`,
          values: [rowData],
        });
        updatedCount++;
      } else {
        appendRows.push(rowData);
        appendedCount++;
      }
    }

    if (updateBatches.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updateBatches,
        },
      });
    }

    if (appendRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Bảo hành!A:M',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: appendRows,
        },
      });
    }

    return {
      totalCases: warrantyCases.length,
      updatedCount,
      appendedCount,
    };
  }
}

export const googleSheetsService = new GoogleSheetsService();
