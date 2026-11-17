# Ghi chú bộ hiệu chuẩn transcript

- `score_cases.json` có 200 ca tổng hợp, không phải bộ bài nói đã được giám khảo IELTS chấm độc lập.
- 63 ca bị lệch câu hỏi/chủ đề đã được ghép lại đúng với nội dung trả lời.
- 50 ca mang nhãn band 4–8 cũ có câu trả lời và mức độ trôi chảy không khớp nhãn. `expected.originalBand` giữ nhãn cũ để đối chiếu; `expected.band` hiện là mốc hồi quy của transcript trong app, với ghi chú `expected.basis`.
- Các ca chỉ có văn bản không thể xác định tốc độ nói, ngập ngừng và phát âm. Vì vậy kết quả 200/200 xác nhận các quy tắc hồi quy của app và các mốc transcript hiện tại; nó không tuyên bố độ chính xác 100% trên bài thi thật.

## Các sửa đổi bộ chấm

- Nhận diện chủ ngữ trước động từ hữu hạn phù hợp hơn với cụm phân từ và mệnh đề quan hệ.
- Không xem việc transcript không có từ nối/ngập ngừng là bằng chứng Fluency thấp.
- Mở rộng từ vựng B2/C1 và khái niệm chủ đề để chấm transcript phong phú hơn.
- Giới hạn kiểm tra lệch chủ đề chính sách vào câu hỏi chính sách, tránh phạt câu hỏi khuyên cách xử lý bất đồng.

## Chạy lại

Từ thư mục `publish`, chạy `node tools/run_score_cases.js --fail-on-ui`.
