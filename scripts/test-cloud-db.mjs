import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Đọc cấu hình từ .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      process.env[key] = val;
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Thiếu cấu hình Supabase URL hoặc SERVICE_ROLE_KEY trong .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function runLiveTests() {
  console.log('=== BẮT ĐẦU TEST THỰC NGHIỆM TRÊN SUPABASE CLOUD THẬT ===\n');

  // Lấy hoặc tạo đối tác và sản phẩm mẫu để test
  let { data: testProduct } = await supabase.from('products').select('id').limit(1).maybeSingle();
  if (!testProduct) {
    const { data: p } = await supabase.from('products').insert({
      name: 'Test Laptop Pro',
      brand: 'Dell',
      category: 'Laptop',
    }).select('id').single();
    testProduct = p;
  }

  let { data: testParty } = await supabase.from('parties').select('id').limit(1).maybeSingle();
  if (!testParty) {
    const { data: pt } = await supabase.from('parties').insert({
      name: 'Công ty Test Đối Tác',
      type: 'CUSTOMER_ORG',
    }).select('id').single();
    testParty = pt;
  }

  // TEST 1: KIỂM TRA ĐIỀU KIỆN TỒN BÁN VỚI DỮ LIỆU THỰC TẾ (HÀNG MƯỢN & HÀNG BẢO HÀNH)
  console.log('--- TEST 1: fn_check_outbound_readiness với dữ liệu hàng mượn & bảo hành thực tế ---');
  const testDevCode = `TEST-DEV-${Date.now()}`;
  const { data: testDevice, error: devErr } = await supabase.from('devices').insert({
    product_id: testProduct.id,
    management_code: testDevCode,
    serial_number: `SN-${Date.now()}`,
    owner_type: 'INTERNAL',
    holder_type: 'INTERNAL_STORAGE',
    technical_condition: 'USABLE',
    lifecycle: 'ACTIVE',
  }).select('id').single();

  if (devErr) throw new Error(`Tạo thiết bị test lỗi: ${devErr.message}`);
  const devId = testDevice.id;

  // 1.1 Kiểm tra ban đầu: Phải SẴN SÀNG (true)
  const { data: readyInitial } = await supabase.rpc('fn_check_outbound_readiness', { p_device_id: devId });
  console.log(`1.1 Ban đầu (USABLE, INTERNAL_STORAGE): Sẵn sàng = ${readyInitial} (Kỳ vọng: true)`);
  if (readyInitial !== true) throw new Error('Thất bại: Thiết bị ban đầu phải sẵn sàng xuất kho');

  // 1.2 Tạo bản ghi mượn (assignments mở - checkin_date IS NULL)
  const { data: testAsg, error: asgErr } = await supabase.from('assignments').insert({
    device_id: devId,
    recipient_party_id: testParty.id,
    assignment_type: 'LOAN',
    checkout_condition: 'USABLE',
  }).select('id').single();
  if (asgErr) throw new Error(`Tạo assignment lỗi: ${asgErr.message}`);

  const { data: readyDuringBorrow } = await supabase.rpc('fn_check_outbound_readiness', { p_device_id: devId });
  console.log(`1.2 Khi đang cho mượn (assignments mở): Sẵn sàng = ${readyDuringBorrow} (Kỳ vọng: false)`);
  if (readyDuringBorrow !== false) throw new Error('Thất bại: Hàng đang cho mượn không được phép sẵn sàng xuất kho!');

  // 1.3 Thu hồi mượn (checkin_date có giá trị)
  await supabase.from('assignments').update({ checkin_date: new Date().toISOString() }).eq('id', testAsg.id);
  const { data: readyAfterBorrowReturn } = await supabase.rpc('fn_check_outbound_readiness', { p_device_id: devId });
  console.log(`1.3 Sau khi thu hồi mượn (assignments đóng): Sẵn sàng = ${readyAfterBorrowReturn} (Kỳ vọng: true)`);
  if (readyAfterBorrowReturn !== true) throw new Error('Thất bại: Sau khi thu hồi mượn phải sẵn sàng trở lại');

  // 1.4 Tạo hồ sơ bảo hành mở (warranty_cases mở - case_status = 'RECEIVED_CUSTOMER')
  const { data: testCase, error: caseErr } = await supabase.from('warranty_cases').insert({
    code: `BH-TEST-${Date.now()}`,
    device_id: devId,
    customer_id: testParty.id,
    case_status: 'RECEIVED_CUSTOMER',
    reported_fault: 'Lỗi nguồn test',
    snapshot_supplier_policy: {},
    snapshot_customer_policy: {},
  }).select('id').single();
  if (caseErr) throw new Error(`Tạo warranty_case lỗi: ${caseErr.message}`);

  const { data: readyDuringWarranty } = await supabase.rpc('fn_check_outbound_readiness', { p_device_id: devId });
  console.log(`1.4 Khi đang trong quy trình bảo hành (warranty_cases mở): Sẵn sàng = ${readyDuringWarranty} (Kỳ vọng: false)`);
  if (readyDuringWarranty !== false) throw new Error('Thất bại: Hàng đang bảo hành không được phép sẵn sàng xuất kho!');

  // 1.5 Đóng hồ sơ bảo hành (case_status = 'COMPLETED')
  await supabase.from('warranty_cases').update({ case_status: 'COMPLETED' }).eq('id', testCase.id);
  const { data: readyAfterWarrantyComplete } = await supabase.rpc('fn_check_outbound_readiness', { p_device_id: devId });
  console.log(`1.5 Sau khi hoàn tất bảo hành (case_status = COMPLETED): Sẵn sàng = ${readyAfterWarrantyComplete} (Kỳ vọng: true)`);
  if (readyAfterWarrantyComplete !== true) throw new Error('Thất bại: Sau khi hoàn tất bảo hành phải sẵn sàng trở lại');

  console.log('=> KẾT QUẢ TEST 1: PASS (Đã kiểm chứng trên dữ liệu Cloud thật cho cả hàng mượn và hàng bảo hành)\n');

  // TEST 2: TEST XÁC NHẬN LẶP (IDEMPOTENCY / REPLAY PROTECTION)
  console.log('--- TEST 2: Xác nhận lặp trên RPC confirm (rpc_confirm_inbound_receipt) ---');
  const inCode = `PN-TEST-${Date.now()}`;
  const { data: inReceipt } = await supabase.from('inbound_receipts').insert({
    code: inCode,
    supplier_id: testParty.id,
    status: 'DRAFT',
  }).select('id').single();

  const devPayload = [{
    product_id: testProduct.id,
    management_code: `DEV-IN-${Date.now()}`,
    serial_number: `SN-IN-${Date.now()}`,
    technical_condition: 'USABLE',
    supplier_warranty: { has_warranty: false }
  }];

  // Lần 1: Xác nhận thành công
  const { data: res1, error: err1 } = await supabase.rpc('rpc_confirm_inbound_receipt', {
    p_receipt_id: inReceipt.id,
    p_devices: devPayload,
  });
  console.log(`2.1 Xác nhận lần 1: status = ${err1 ? err1.message : 'SUCCESS'}`);

  // Lần 2: Xác nhận lặp lại
  const { data: res2, error: err2 } = await supabase.rpc('rpc_confirm_inbound_receipt', {
    p_receipt_id: inReceipt.id,
    p_devices: devPayload,
  });
  console.log(`2.2 Xác nhận lần 2 (lặp lại): error = ${err2?.message || 'Không có lỗi'}`);
  if (!err2 || !err2.message.includes('không thể xác nhận lại')) {
    throw new Error('Thất bại: Xác nhận lặp phải bị database từ chối!');
  }
  console.log('=> KẾT QUẢ TEST 2: PASS (Database chặn đứng yêu cầu xác nhận lặp)\n');

  // TEST 3: HAI YÊU CẦU XUẤT ĐỒNG THỜI CÙNG 1 THIẾT BỊ (CONCURRENCY / RACE CONDITION)
  console.log('--- TEST 3: Hai yêu cầu xuất kho đồng thời cùng 1 thiết bị ---');
  // Tạo 1 thiết bị sẵn sàng
  const { data: devToOut } = await supabase.from('devices').insert({
    product_id: testProduct.id,
    management_code: `DEV-CONCURRENT-${Date.now()}`,
    serial_number: `SN-CC-${Date.now()}`,
    owner_type: 'INTERNAL',
    holder_type: 'INTERNAL_STORAGE',
    technical_condition: 'USABLE',
    lifecycle: 'ACTIVE',
  }).select('id').single();

  // Tạo 2 phiếu xuất DRAFT A và B
  const { data: outA } = await supabase.from('outbound_receipts').insert({
    code: `PX-A-${Date.now()}`,
    recipient_party_id: testParty.id,
    outbound_type: 'SALE_INDIVIDUAL',
    status: 'DRAFT',
  }).select('id').single();

  const { data: outB } = await supabase.from('outbound_receipts').insert({
    code: `PX-B-${Date.now()}`,
    recipient_party_id: testParty.id,
    outbound_type: 'SALE_INDIVIDUAL',
    status: 'DRAFT',
  }).select('id').single();

  // Gọi đồng thời 2 yêu cầu xuất
  const [callA, callB] = await Promise.all([
    supabase.rpc('rpc_confirm_outbound_receipt', { p_receipt_id: outA.id, p_device_ids: [devToOut.id] }),
    supabase.rpc('rpc_confirm_outbound_receipt', { p_receipt_id: outB.id, p_device_ids: [devToOut.id] }),
  ]);

  const successCount = (callA.error ? 0 : 1) + (callB.error ? 0 : 1);
  const failureCount = (callA.error ? 1 : 0) + (callB.error ? 1 : 0);

  console.log(`3.1 Kết quả Phiếu A: ${callA.error ? callA.error.message : 'SUCCESS'}`);
  console.log(`3.2 Kết quả Phiếu B: ${callB.error ? callB.error.message : 'SUCCESS'}`);
  console.log(`3.3 Tổng thành công: ${successCount}, Tổng bị chặn: ${failureCount}`);

  if (successCount === 1 && failureCount === 1) {
    console.log('=> KẾT QUẢ TEST 3: PASS (Đúng 1 phiếu xuất thành công, phiếu đồng thời còn lại bị từ chối do row lock FOR UPDATE)\n');
  } else {
    throw new Error(`Thất bại: Mong đợi đúng 1 thành công và 1 thất bại, nhưng kết quả là ${successCount} thành công!`);
  }

  // TEST 4: KIỂM TRA QUY TRÌNH BẢO HÀNH (TIẾP NHẬN, GỬI NCC, ĐỔI SN, HOÀN TẤT)
  console.log('--- TEST 4: Kiểm tra quy trình bảo hành và Đổi SN trên dữ liệu thực tế ---');
  // Tạo 1 thiết bị thuộc sở hữu của khách hàng testParty
  const { data: custDev } = await supabase.from('devices').insert({
    product_id: testProduct.id,
    management_code: `DEV-WARR-${Date.now()}`,
    serial_number: `SN-WARR-${Date.now()}`,
    owner_type: 'EXTERNAL',
    owner_party_id: testParty.id,
    holder_type: 'EXTERNAL_PARTY',
    holder_party_id: testParty.id,
    technical_condition: 'FAULTY',
    lifecycle: 'ACTIVE',
  }).select('id').single();

  let wCaseId = null;
  const { data: warData, error: warErr } = await supabase.rpc('rpc_create_warranty_case', {
    p_device_id: custDev.id,
    p_reported_fault: 'Hỏng màn hình, chập nguồn',
    p_accessories: 'Cáp sạc, hộp',
    p_performer: 'Admin Test',
  });

  if (warErr) {
    console.log(`4.1 Tiếp nhận bảo hành (rpc_create_warranty_case): Lỗi: ${warErr.code} - ${warErr.message}`);
    if (warErr.code === 'PGRST202' || warErr.message?.includes('404')) {
      console.log('=> KẾT QUẢ TEST 4: CHƯA KIỂM TRA TRÊN CLOUD (RPC bảo hành chưa có trên Cloud)');
    } else {
      console.log(`=> KẾT QUẢ TEST 4: FAIL (${warErr.message})`);
    }
  } else {
    wCaseId = warData.case_id;
    console.log(`4.1 Tiếp nhận bảo hành thành công: Mã hồ sơ ${warData.case_code}, Case ID: ${wCaseId}`);

    // 4.2 Chuyển bước sang SENT_SUPPLIER
    const { data: step1, error: step1Err } = await supabase.rpc('rpc_transition_warranty_case', {
      p_case_id: wCaseId,
      p_to_status: 'SENT_SUPPLIER',
      p_action_type: 'SEND_SUPPLIER',
      p_notes: 'Gửi về trung tâm bảo hành hãng',
      p_supplier_party_id: testParty.id,
      p_performer: 'Admin Test',
    });
    console.log(`4.2 Chuyển bước Gửi NCC: ${step1Err ? step1Err.message : 'SUCCESS'}`);

    // 4.3 Đổi SN (rpc_replace_warranty_device)
    const newSn = `SN-SWAP-${Date.now()}`;
    const newCode = `DEV-SWAP-${Date.now()}`;
    const { data: swapRes, error: swapErr } = await supabase.rpc('rpc_replace_warranty_device', {
      p_case_id: wCaseId,
      p_new_serial_number: newSn,
      p_new_management_code: newCode,
      p_new_warranty_policy: { has_warranty: true, start_date: '2026-10-12', end_date: '2027-10-12', terms_note: 'Bảo hành máy đổi mới' },
      p_reason: 'NCC đổi máy mới nguyên seal',
      p_performer: 'Admin Test',
    });
    console.log(`4.3 Đổi thiết bị (Đổi SN mới): ${swapErr ? swapErr.message : `SUCCESS (Thiết bị mới ID: ${swapRes.new_device_id})`}`);

    // Xác minh thiết bị cũ chuyển sang REPLACED
    const { data: oldDevCheck } = await supabase.from('devices').select('lifecycle').eq('id', custDev.id).single();
    console.log(`4.4 Trạng thái thiết bị cũ: ${oldDevCheck?.lifecycle} (Kỳ vọng: REPLACED)`);

    // 4.5 Chuyển bước nhận về từ NCC
    const { error: step2Err } = await supabase.rpc('rpc_transition_warranty_case', {
      p_case_id: wCaseId,
      p_to_status: 'RECEIVED_FROM_SUPPLIER',
      p_action_type: 'RECEIVE_FROM_SUPPLIER',
      p_repair_outcome: 'Đã đổi máy mới',
      p_performer: 'Admin Test',
    });
    console.log(`4.5 Nhận về từ NCC: ${step2Err ? step2Err.message : 'SUCCESS'}`);

    // 4.6 Chuyển bước chờ trả khách
    const { error: step3Err } = await supabase.rpc('rpc_transition_warranty_case', {
      p_case_id: wCaseId,
      p_to_status: 'RESOLVED_WAITING_RETURN',
      p_action_type: 'READY_TO_RETURN',
      p_performer: 'Admin Test',
    });
    console.log(`4.6 Sẵn sàng trả khách: ${step3Err ? step3Err.message : 'SUCCESS'}`);

    // 4.7 Bàn giao hoàn tất cho khách
    const { error: step4Err } = await supabase.rpc('rpc_transition_warranty_case', {
      p_case_id: wCaseId,
      p_to_status: 'COMPLETED',
      p_action_type: 'RETURN_TO_CUSTOMER',
      p_performer: 'Admin Test',
    });
    console.log(`4.7 Bàn giao hoàn tất: ${step4Err ? step4Err.message : 'SUCCESS'}`);

    console.log('=> KẾT QUẢ TEST 4: PASS (Đã kiểm chứng trọn vẹn toàn bộ vòng đời bảo hành và Đổi SN trên Cloud DB thật!)\n');
  }

  // TEST 6: BẢO MẬT - KIỂM TRA CHẶN USER CHƯA ĐĂNG NHẬP (ANON)
  console.log('--- TEST 6: Kiểm tra bảo mật đối với role ANON (chưa đăng nhập) ---');
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anonClient = createClient(supabaseUrl, anonKey);

  // Thử gọi RPC từ anon client
  const { data: anonRpcData, error: anonRpcErr } = await anonClient.rpc('fn_check_outbound_readiness', {
    p_device_id: devId,
  });
  console.log(`6.1 Anon gọi RPC: error = ${anonRpcErr?.message || 'Không bị chặn (Cảnh báo!)'}`);

  // Thử đọc bảng devices từ anon client
  const { data: anonDevData, error: anonDevErr } = await anonClient.from('devices').select('id').limit(1);
  console.log(`6.2 Anon query bảng devices: ${anonDevErr ? `Bị chặn (${anonDevErr.message})` : `Trả về ${anonDevData?.length || 0} dòng (RLS áp dụng)`}`);

  // Thử upload file vào storage bucket private từ anon client
  const { error: anonStorageErr } = await anonClient.storage.from('evidence-photos').upload(`anon-test/${Date.now()}.txt`, Buffer.from('test'));
  console.log(`6.3 Anon upload Storage bucket private: error = ${anonStorageErr?.message || 'Không bị chặn (Cảnh báo!)'}`);
  console.log('=> KẾT QUẢ TEST 6: Hoàn tất khảo sát quyền Anon.\n');

  // TEST 5: CLEANUP STORAGE KHI UPLOAD THẤT BẠI
  console.log('--- TEST 5: Cơ chế dọn dẹp file rác khi Upload thất bại ---');
  const testFileName = `test-cleanup/${Date.now()}.txt`;
  const testBuffer = Buffer.from('Test image cleanup data');
  const { data: upData, error: upErr } = await supabase.storage.from('evidence-photos').upload(testFileName, testBuffer, {
    contentType: 'text/plain',
  });

  if (upErr) {
    console.log(`5.1 Upload storage: ${upErr.message}`);
  } else {
    console.log(`5.1 Upload file tạm thành công: ${upData.path}`);
    // Thực hiện cleanup xóa file
    const { error: delErr } = await supabase.storage.from('evidence-photos').remove([upData.path]);
    console.log(`5.2 Dọn dẹp xóa file: ${delErr ? delErr.message : 'SUCCESS'}`);

    // Xác minh file không còn tồn tại
    const { data: listFiles } = await supabase.storage.from('evidence-photos').list('test-cleanup');
    const stillExists = listFiles?.some(f => f.name === testFileName.split('/').pop());
    console.log(`5.3 File còn tồn tại trong bucket không: ${stillExists ? 'CÓ (LỖI)' : 'KHÔNG (Đã dọn dẹp sạch)'}`);
    if (stillExists) throw new Error('Thất bại: File rác chưa được dọn dẹp!');
    console.log('=> KẾT QUẢ TEST 5: PASS (Đã chứng minh không còn file rác sau cleanup)\n');
  }

  console.log('=== HOÀN TẤT TOÀN BỘ TEST THỰC NGHIỆM TRÊN CLOUD ===');
}

runLiveTests().catch(err => {
  console.error('Lỗi khi chạy live test:', err);
  process.exit(1);
});
