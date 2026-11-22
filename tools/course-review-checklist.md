# Danh sách duyệt nội dung pilot Khóa học

**Trạng thái:** Chưa duyệt. Tất cả 20 bài vẫn đặt `reviewed:false`; chưa đưa bản nội dung này lên bản công khai trước khi hoàn tất rà soát.

Đánh dấu từng ô sau khi kiểm tra trực tiếp trong bài học. Nếu cần sửa, cập nhật JSON, chạy `node tools/validate-courses.mjs --emit-runtime`, rồi duyệt lại bài đó.

## Giao tiếp hằng ngày · A1–A2

| Bài | Tệp dữ liệu | Nghĩa EN–VI | Ví dụ tự nhiên | Từ không trùng | Bước và đáp án | Duyệt |
|---|---|---|---|---|---|---|
| Bắt đầu cuộc trò chuyện | `daily-small-talk.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Nói về sở thích | `daily-small-talk.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Kể về một ngày thường | `daily-small-talk.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Gọi món đơn giản | `daily-small-talk.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Hỏi đường trong trường | `daily-small-talk.json` | [ ] | [ ] | [ ] | [ ] | [ ] |

## IELTS Speaking Part 1 · Band 4.5–5.5

| Bài | Tệp dữ liệu | Nghĩa EN–VI | Ví dụ tự nhiên | Từ không trùng | Bước và đáp án | Duyệt |
|---|---|---|---|---|---|---|
| Mở rộng câu trả lời Part 1 | `ielts-part1-clear.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Nói về thói quen hằng ngày | `ielts-part1-clear.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Nói về nơi mình sống | `ielts-part1-clear.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Nói về việc học hoặc công việc | `ielts-part1-clear.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Nói về thời gian rảnh | `ielts-part1-clear.json` | [ ] | [ ] | [ ] | [ ] | [ ] |

## Phát âm cho người Việt · A2–B1

| Bài | Tệp dữ liệu | Nghĩa EN–VI | Ví dụ tự nhiên | Từ không trùng | Bước và đáp án | Duyệt |
|---|---|---|---|---|---|---|
| Giữ rõ âm cuối | `pronunciation-final-sounds.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Đọc rõ đuôi số nhiều và quá khứ | `pronunciation-final-sounds.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Phân biệt /θ/ và /ð/ | `pronunciation-final-sounds.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Nhấn đúng trọng âm từ | `pronunciation-final-sounds.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Tạo nhịp câu tự nhiên | `pronunciation-final-sounds.json` | [ ] | [ ] | [ ] | [ ] | [ ] |

## Tiếng Anh cho sinh viên điện và năng lượng · A2–B1

| Bài | Tệp dữ liệu | Nghĩa EN–VI | Ví dụ tự nhiên | Từ không trùng | Bước và đáp án | Duyệt |
|---|---|---|---|---|---|---|
| Trao đổi về an toàn điện | `engineering-safety-briefing.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Báo cáo tình huống suýt xảy ra sự cố | `engineering-safety-briefing.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Mô tả mạch điện đơn giản | `engineering-safety-briefing.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Nói về năng lượng tái tạo | `engineering-safety-briefing.json` | [ ] | [ ] | [ ] | [ ] | [ ] |
| Trình bày kết quả đo | `engineering-safety-briefing.json` | [ ] | [ ] | [ ] | [ ] | [ ] |

## Kiểm tra trước khi duyệt toàn bộ

- [ ] Các bản dịch Việt ngữ đúng nghĩa và tự nhiên ở đúng cấp độ.
- [ ] Ví dụ, hội thoại và gợi ý nói không lặp câu máy móc, không dùng nội dung trích dẫn.
- [ ] 60 mục từ vựng không bị trùng giữa các bài; nghĩa và cách dùng đúng ngữ cảnh.
- [ ] Bước phát âm mô tả đúng âm; phần điện chỉ giải thích thuật ngữ và kết quả trong bối cảnh học tập có giám sát.
- [ ] Câu hỏi trắc nghiệm có đáp án đúng và giải thích dễ hiểu.
- [ ] Chỉ chuyển `reviewed` thành `true` sau khi người duyệt chấp thuận nội dung tương ứng.
