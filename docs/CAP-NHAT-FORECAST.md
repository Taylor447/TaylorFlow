# Cập nhật gói Forecast TaylorFlow

Forecast là nội dung luyện tập theo chủ đề do TaylorFlow soạn, không phải đề IELTS được xác nhận trước. IELTS không công bố trước câu hỏi thi. Các nhãn Sep–Dec, Jan–Apr là quy ước giai đoạn tham khảo, không phải lịch đổi đề chính thức.

## Thêm gói mới

1. Chọn id dạng `YYYY-MM-DD`, ví dụ `2027-05-08`, rồi tạo `assets/forecast/src/<id>/pack.json`.
2. Khai báo `title`, `label`, `validFrom`, `validTo`, `updated` và `sourceLabel`. Dùng nhãn nguồn `đề luyện tập theo chủ đề — do TaylorFlow soạn`.
3. Thêm các tệp `content-01.json`, `content-02.json` theo schema hiện có. Part 1 có 12 chủ đề, mỗi chủ đề 5 câu. Mỗi cue card Part 2 cần đúng bốn gạch đầu dòng, câu kết và đúng bốn câu Part 3 liên quan.
4. Với từng câu, viết gợi ý riêng gồm 1–3 ý tiếng Việt, sáu cụm từ Anh–Việt, một gợi ý ngữ pháp và bài mẫu tiếng Anh: Part 1 từ 35–70 từ, Part 2 từ 170–250 từ, Part 3 từ 60–110 từ. Mọi trường `reviewed` phải là `false`; không ghi nội dung như đã được giáo viên duyệt.
5. Kiểm tra riêng gói mới bằng `python tools/validate_forecast.py <id> --allow-partial` khi còn đang soạn. Trước khi hoàn tất, bỏ `--allow-partial` để xác nhận đủ hạn mức.

## Xây dựng và kiểm tra

`python tools/build_forecast.py --allow-partial --updated YYYY-MM-DD` sẽ kiểm tra các gói nguồn, tạo các tệp JavaScript tĩnh và cập nhật manifest. Dùng `--allow-partial` trong thời gian còn gói khung rỗng hoặc đang soạn dở. Khi mọi gói được xây dựng đã đủ nội dung, bỏ tùy chọn đó.

Sau khi dựng, chạy `python tools/validate_forecast.py --all --allow-partial` và kiểm tra `assets/forecast/index.js`, số đếm trong manifest, rồi mở trang ở cả hai giao diện và các theme. Không đưa câu hỏi cá nhân trong IndexedDB vào các gói dựng sẵn; dữ liệu đó nằm riêng trên thiết bị người học.

## Ngày hiệu lực và kho đề cũ

Manifest tự xác định trạng thái theo ngày địa phương của thiết bị: trước `validFrom` là “sắp tới”, trong khoảng hiệu lực là “hiện tại”, sau `validTo` là “đã qua”. Gói sắp tới được ẩn khỏi danh sách luyện cho tới ngày bắt đầu; gói đã qua chuyển vào Kho đề cũ và vẫn luyện được. Khi kiểm tra tình huống ngày khác, đặt ngày hệ thống tạm thời rồi tải lại trang.

## Ngoại tuyến và service worker

Mỗi gói là tệp JavaScript tĩnh trong `assets/forecast/`; ứng dụng nạp gói theo nhu cầu và không cần CDN hay yêu cầu mạng mới. Nếu service worker precache gói mới trong `service-worker.js`, thêm tên tệp vào danh sách forecast và tăng `VERSION` để người dùng nhận cache mới. Giữ phiên bản tăng đơn điệu, không xóa dữ liệu IndexedDB của đề người dùng.
