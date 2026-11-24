# Báo cáo lỗ hổng bảo mật

## Phiên bản được hỗ trợ

| Phiên bản | Hỗ trợ bản vá bảo mật |
| --- | --- |
| Bản mới nhất trên nhánh `main` | Có |
| Bản phát hành cũ | Không cam kết |

TaylorFlow là ứng dụng tĩnh chạy trên trình duyệt cùng một Cloudflare Worker cho phòng học trực tuyến. Bản nháp, tiến độ học và bản ghi âm trong các luồng học cá nhân được lưu trên thiết bị. Khi dùng phòng học cùng bạn, tên hiển thị, tin nhắn, câu trả lời và âm thanh của phiên được chuyển qua Worker để gửi cho người trong phòng; không dùng phòng học nếu bạn không muốn chia sẻ các dữ liệu này. Dữ liệu trạng thái phòng tự hết hạn sau tối đa 2 giờ; âm thanh được chuyển tiếp qua kết nối nhưng không ghi vào trạng thái lưu của phòng.

## Lưu ý triển khai

GitHub Pages không cho dự án tĩnh đặt response headers tùy chỉnh từ repository. Trang thêm CSP meta tag giới hạn object, base URL và form; đây là lớp bảo vệ bổ sung, chưa phải CSP chống XSS đầy đủ vì app hiện còn nhiều script và event handler nội tuyến. Meta tag cũng không thể thay thế `frame-ancestors`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` hay `Permissions-Policy`. Tại lần kiểm tra ngày 25/11/2026, trang GitHub Pages trả HSTS nhưng chưa trả các header còn thiếu; cần cấu hình chúng tại lớp hosting/proxy nếu muốn áp dụng cho toàn bộ trang.

Các phiên coop lưu token trong `sessionStorage` của trình duyệt và gửi token xác thực trong phần thân thông điệp WebSocket đầu tiên; token không nằm trong URL. Bộ nhớ trình duyệt không được mã hóa bởi TaylorFlow, vì vậy ai có quyền truy cập cùng hồ sơ trình duyệt có thể đọc dữ liệu cục bộ.

## Cách báo cáo riêng tư

Không đăng token, thông tin tài khoản, bản ghi âm hoặc hướng khai thác lên Issues hay Pull Requests công khai.

Nếu GitHub hiển thị nút **Report a vulnerability** trong mục Security của kho TaylorFlow, hãy gửi báo cáo qua GitHub Security Advisories. Nếu không thấy nút này, hãy nhắn riêng cho chủ kho `Taylor447` qua kênh liên hệ trên hồ sơ GitHub và chỉ gửi bước tái hiện tối thiểu; không đính kèm thông tin bí mật thật.

Người duy trì dự kiến xác nhận đã nhận báo cáo trong 3 ngày làm việc và gửi cập nhật tiến độ ít nhất mỗi 7 ngày cho đến khi xử lý xong hoặc thống nhất kế hoạch.

## Nội dung hữu ích trong báo cáo

- Trang hoặc thành phần bị ảnh hưởng và trình duyệt/phiên bản.
- Các bước tái hiện tối thiểu, kết quả thực tế và ảnh hưởng có thể xảy ra.
- Bản ghi mạng đã xóa cookie, token, địa chỉ riêng và nội dung cá nhân.
- Môi trường thử nghiệm; không kiểm thử phá hoại trên phòng hoặc dữ liệu của người khác.

Không gửi dữ liệu micro, bản ghi âm hoặc bài viết của người dùng để minh họa lỗ hổng.
