# Kiểm tra hệ thống ngày 09/11/2026

## Luồng ứng dụng

`reports/api-checks.json`: **38/38 kiểm tra đạt** trên FastAPI chạy thật ở
`127.0.0.1:8011`, với thư mục dữ liệu kiểm tra riêng. Không dùng tài khoản,
phiên đăng nhập, camera hoặc lịch sử sự kiện của bản đang sử dụng.

Đã kiểm tra đăng ký email/số điện thoại, trạng thái chờ duyệt, duyệt/từ chối,
duyệt lại, đăng nhập sau duyệt, quyền admin/viewer, thu hồi phiên sau từ chối,
chuẩn hóa số điện thoại và chặn đăng ký trùng. API cũng nhận JPEG multipart,
phân tích một video Fall và một video No_Fall, trả đủ bốn phương án so sánh và
phục vụ được video kết quả.

Đã sửa hai lỗi tìm thấy trong quá trình chạy:

- Webcam gửi JPEG thô trong khi API yêu cầu tệp multipart: đổi sang FormData.
- Nhánh tư thế nằm trước khi LSTM sẵn sàng định dạng điểm `None` thành phần
  trăm: chuyển lời giải thích sang nguồn quyết định thực tế, không yêu cầu điểm
  LSTM khi chưa có dự đoán. Lần đánh giá CSV sau sửa không còn lỗi chạy.

## Giao diện desktop và điện thoại

`reports/frontend-checks.json`: 50 tham chiếu tài nguyên nội bộ đều tồn tại;
16 tệp JavaScript được tải đều qua kiểm tra cú pháp. Đã kiểm tra logic duyệt và
từ chối hàng loạt bằng chính hàm frontend trong môi trường Node cô lập.

Các sửa đổi từ rà soát mã:

- Sửa thông báo đăng nhập còn hướng dẫn tạo admin đầu tiên.
- Bật kiểm tra các trường bắt buộc trước khi gửi form đăng ký/đăng nhập.
- Giữ bảng tài khoản đủ rộng trong khung cuộn ngang, tránh CSS chung ép tám
  cột co vào màn hình điện thoại.
- Cố định kích thước checkbox và icon thao tác, tăng vùng chạm lên 44 px trên
  màn hình nhỏ; trường đăng nhập trên điện thoại dùng chữ 16 px.
- Menu có liên kết nhận focus bằng bàn phím và trạng thái `aria-current` đúng
  khi chuyển trang từ các vị trí khác nhau.

**Chưa kiểm tra trực quan trên trình duyệt:** Browser access host và Windows
native pipe đều không khả dụng, kể cả sau khi thử lại và khởi tạo lại công cụ.
Các kiểm tra mã trên không thay thế ảnh chụp hoặc tương tác desktop/mobile.

Khi kết nối trình duyệt hoạt động, cần xác nhận các trang đăng nhập/đăng ký,
tổng quan, camera/video, sự cố, tài khoản, hồ sơ, cài đặt, thống kê, bảo mật,
liên hệ và cấu hình AI ở 1440×900, 768×1024 và 390×844. Kiểm tra cuộn bảng,
modal, tiêu điểm bàn phím, menu di động, trạng thái rỗng/lỗi và thao tác batch.

## Đánh giá phát hiện ngã

Giữ nguyên ngưỡng mặc định trong lần đo: thời gian giữ tư thế hiệu lực **4,1
giây**. Không chọn lại ngưỡng trên tập test.

### Lớp quyết định với keypoint có sẵn

`reports/benchmark-csv.json`: toàn bộ **1.409 clip** trong thư mục test, gồm
638 Fall và 771 No_Fall; không có lỗi chạy sau khi sửa lỗi điểm `None`.
Mỗi phương án dùng chung bộ lọc chất lượng pose của ứng dụng; phương án LSTM
ở đây bao gồm cửa sổ 40 frame và điều kiện phiếu ổn định.

| Phương án | Phát hiện đúng / 638 clip ngã | Báo nhầm / 771 clip không ngã | Recall |
| --- | ---: | ---: | ---: |
| Hình học | 0 | 6 | 0% |
| LSTM với bộ lọc/phiếu hiện tại | 9 | 2 | 1,41% |
| Bắt buộc đồng thuận | 0 | 0 | 0% |
| Kết hợp nhiều giai đoạn | 0 | 0 | 0% |

### Video gốc có chạy YOLO

`reports/benchmark-raw.json`: 24 video được chọn theo vị trí đều trong danh
sách tên đã sắp xếp, gồm 12 Fall và 12 No_Fall. Cả bốn phương án đều có 0
phát hiện đúng, 12 bỏ sót và 0 báo nhầm. Số khung hình xử lý đã được đối chiếu
với metadata; không có video bị cắt ngắn do giải mã trong báo cáo này.
Đây là mẫu nhỏ để kiểm tra đường chạy, không phải đánh giá toàn bộ YOLO.

### Kiểm tra riêng trọng số LSTM

`reports/lstm-windows.json`: 14.315 cửa sổ trong `csv_sequences/test.npz`.
Accuracy **81,00%**, recall **62,80%**, precision **79,39%**. Đây là chỉ số
phân loại cửa sổ, không phải tỷ lệ phát hiện sự kiện ngã của ứng dụng.

### Điều rút ra từ lần đo

- 1.238/1.409 clip ngắn hơn 4,1 giây, trong đó 604/638 clip Fall. Yêu cầu giữ
  tư thế ngang 4,1 giây không thể được xác minh trong các clip ngắn này.
- 553 clip có ít hơn 40 frame pose hợp lệ; 93 clip không có frame pose hợp lệ.
- Bộ lọc chiều cao hộp người loại 30.121 frame. Điều kiện chiều cao tối thiểu
  cần được kiểm tra lại cho tư thế nằm ngang, khi chiều cao hộp giảm tự nhiên.
- Không báo nhầm trong phương án kết hợp không chứng minh hệ thống tốt khi
  cùng lúc bỏ sót toàn bộ clip ngã của phép đo.

Trước khi dùng kết quả cho đồ án, cần sửa thiết kế bộ lọc và khoảng thời gian
quan sát trên **tập validation**, sau đó khóa cấu hình và đo lại test. Cần
video có đủ đoạn trước/sau ngã và nhãn thời điểm bắt đầu ngã để đo độ trễ.
Tập hiện tại chỉ có nhãn toàn clip; báo cáo không tạo số độ trễ giả định.
Chưa xác minh độc lập việc tách người/bối cảnh giữa train và test.

## Chạy lại

Từ `C:\detect`:

```powershell
.\.venv\Scripts\python.exe qa/verify_system.py
.\.venv\Scripts\python.exe qa/verify_frontend.py
node qa/test_frontend_logic.js
.\.venv\Scripts\python.exe qa/benchmark_falls.py --mode csv
.\.venv\Scripts\python.exe qa/benchmark_falls.py --mode raw --limit-per-class 12
.\.venv\Scripts\python.exe qa/evaluate_lstm_windows.py
```

`qa/runtime/` chứa tài khoản và dữ liệu thử, được bỏ qua bởi Git. Script API
tự dừng backend kiểm tra khi kết thúc. Báo cáo có SHA-256 trọng số LSTM để
đối chiếu lần đo sau.
