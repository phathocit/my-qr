import { google, sheets_v4 } from 'googleapis';
import { Product, Device } from '@/types/database';

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

export function getSheetsClient(): { sheets: sheets_v4.Sheets; spreadsheetId: string } {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  if (!email || !rawKey || !spreadsheetId) {
    throw new Error(
      'Chưa cấu hình đầy đủ biến môi trường Google Sheets: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_SPREADSHEET_ID'
    );
  }

  // Khôi phục ký tự xuống dòng của RSA Private Key từ chuỗi .env
  const privateKey = rawKey.replace(/\\n/g, '\n');
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
}

export const googleSheetsService = new GoogleSheetsService();
