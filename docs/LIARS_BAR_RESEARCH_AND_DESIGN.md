# Nghiên Cứu & Thiết Kế Game: Liar's Bar 2D (Online Web Version)

## 1. Tổng Quan Nghiên Cứu *Liar's Bar* (Chế Độ *Liar's Deck* — Bài Nói Dối)

### 1.1. Bối Cảnh & Vòng Lặp Tâm Lý Cốt Lõi
*Liar's Bar* là tựa game đấu trí tâm lý kết hợp giữa trò **Bài Nói Dối (*Bullshit / Cheat*)** và **Cò Quay Nga (*Russian Roulette*)** trong một quán rượu ngầm cổ điển. Trong chế độ **Liar's Deck**, 2–4 người chơi ngồi quanh một chiếc bàn gỗ và đấu trí qua từng lượt đánh bài úp.

### 1.2. Cấu Trúc Bộ Bài 20 Lá Chuẩn (*Canonical 20-Card Deck*)
- **6 lá King (`K` — Già)**
- **6 lá Queen (`Q` — Đầm)**
- **6 lá Ace (`A` — Át)**
- **2 lá Joker (`J` — Phăng-te / Wildcard)**: Luôn được tính là bài **THẬT** cho bất kỳ bàn bài nào (`K`, `Q` hoặc `A`).
- **Biến thể Ác Quỷ (`Devil Card — D`)**: Thay thế 1 lá Joker bằng 1 lá **Devil (`D`)** (`6 K + 6 Q + 6 A + 1 J + 1 D = 20 lá`).
  - *Quy tắc bắt buộc*: Lá `Devil` **chỉ được phép đánh đơn lẻ (1 lá duy nhất)**, không được kẹp chung với các lá bài khác.
  - *Hiệu ứng bẫy nổ*: Nếu người chơi đánh lá `Devil` xuống bàn và bị người kế tiếp hô **"LẬT BÀI! (LIAR!)"**, toàn bộ những người chơi khác đang còn sống trên bàn (trừ người đánh lá Devil) đều phải rút súng lục tự bắn!

### 1.3. Luật Chơi Chi Tiết Từng Vòng
1. **Định danh Bàn Bài (`Table Card / Bài Chủ`)**: Đầu mỗi ván, hệ thống chọn ngẫu nhiên bài chủ của ván đó là **`BÀN K`**, **`BÀN Q`**, hoặc **`BÀN A`**.
2. **Chia Bài**: Xáo bộ 20 lá và chia đều cho mỗi người chơi còn sống **5 lá bài**.
3. **Lượt Đánh (`1–3` lá úp)**:
   - Người tới lượt chọn từ **1 đến 3 lá bài** trên tay, đặt úp xuống giữa bàn và tuyên bố tất cả đều là Bài Chủ (ví dụ: *"Đánh 2 lá K"*).
   - Người chơi có thể nói thật (tất cả lá vừa đánh đều là Bài Chủ hoặc `Joker`) hoặc nói dối (trộn bài khác loại vào).
4. **Quyền Bắt Bài (`LẬT BÀI! / CALL LIAR!`)**:
   - Người chơi kế tiếp có 2 lựa chọn:
     - **Tin / Đánh tiếp**: Chọn 1–3 lá trên tay mình đánh chồng lên tụ bài giữa bàn.
     - **Nghi ngờ — Hô `"LẬT BÀI!"`**: Lật ngửa **loạt bài vừa đánh gần nhất (1–3 lá)** của người chơi trước đó để kiểm tra:
       - **Phát hiện Nói Dối (`Lie Caught`)**: Có ít nhất 1 lá không phải Bài Chủ và không phải `Joker` -> **Kẻ nói dối** phải rút súng lục Cò Quay Nga (`Russian Roulette`) tự bắn.
       - **Bắt Sai — Bài Thật 100% (`Truth Verified`)**: Tất cả các lá vừa lật đều là Bài Chủ hoặc `Joker` -> **Người hô Lật Bài** phải rút súng lục Cò Quay Nga tự bắn vì vu oan.

### 1.4. Cơ Chế Bắn Súng Lục Ổ Quay 6 Ngăn (*Russian Roulette Progression*)
- Mỗi người chơi sở hữu **1 khẩu súng lục ổ quay 6 ngăn riêng biệt**, trong đó có **1 viên đạn thật** được đặt ngẫu nhiên ở 1 trong 6 vị trí (`bulletIndex ∈ [0..5]`) từ đầu trận.
- Mỗi lần bị phạt bóp cò (`pullTrigger`), kim hỏa gõ vào ngăn hiện tại (`chamberIndex`) rồi tiến thêm `+1` ngăn cho các lần sau:
  - Lần 1: Xác suất nổ súng là $\frac{1}{6}$ (`16.7%`)
  - Lần 2: Xác suất nổ súng là $\frac{1}{5}$ (`20.0%`)
  - Lần 3: Xác suất nổ súng là $\frac{1}{4}$ (`25.0%`)
  - Lần 4: Xác suất nổ súng là $\frac{1}{3}$ (`33.3%`)
  - Lần 5: Xác suất nổ súng là $\frac{1}{2}$ (`50.0%`)
  - Lần 6: Xác suất nổ súng là $\frac{1}{1}$ (`100%` — Chắc chắn trúng đạn!)
- **Nếu `CẠCH!` (Đạn Rỗng / Blank)**: Người chơi sống sót qua kiếp nạn, nhưng số ngăn súng đã thử (`shotsTaken / 6`) vẫn **giữ nguyên** sang ván bài mới.
- **Nếu `ĐOÀNG!` (Trúng Đạn / Lethal)**: Người chơi gục ngã và bị loại khỏi bàn chơi.

---

## 2. Giải Pháp Thiết Kế Luật: *"Đánh Hết Bài Là Win + Cơ Chế Bắn Súng"*

Hệ thống hỗ trợ **2 chế độ thắng có thể chọn ngay tại Sảnh / Tạo Phòng**, với chế độ **Đánh Hết Bài Là Thắng + Súng Lục (`EMPTY_HAND_WIN`)** làm mặc định:

### 2.1. Chế Độ Mặc Định: `ĐÁNH HẾT BÀI LÀ THẮNG + SÚNG LỤC` (`EMPTY_HAND_WIN`)
1. **Chiến Thắng Bằng Đánh Hết Bài (`Empty-Hand Victory`)**:
   - Khi một người chơi đánh xuống những lá bài cuối cùng trên tay (`hand.length === 0`), trận đấu lập tức bước vào trạng thái **`CƠ HỘI XÉT BÀI CUỐI` (`FINAL_CHALLENGE_WINDOW`)**.
   - Người chơi kế tiếp bắt buộc phải đưa ra quyết định sinh tử:
     - **Lựa chọn 1 — `CHO QUA / TIN TƯỞNG` (`passFinalChallenge`)**: Không dám lật bài -> Người vừa đánh hết bài **THẮNG NGAY LẬP TỨC** (`EMPTY_HAND_VICTORY`)!
     - **Lựa chọn 2 — `LẬT BÀI CUỐI!` (`callLiar`)**:
       - Nếu loạt bài cuối cùng là **BÀI THẬT 100%** (trùng Bài Chủ hoặc `Joker`): Kẻ nghi ngờ phải rút súng bắn phạt trước, và người đánh hết bài **THẮNG TRẬN ĐẤU** (`EMPTY_HAND_VICTORY`)!
       - Nếu loạt bài cuối cùng là **NÓI DỐI (`Bluff Caught`)**: Chiến thắng bị chặn đứng! Kẻ định đánh lừa để về nhất bị bắt quả tang và phải **rút súng lục Cò Quay Nga (`1/6 -> 6/6`)**:
         - Nếu trúng đạn (`ĐOÀNG!`) -> Bị loại ngay lập tức!
         - Nếu đạn lép (`CẠCH!`) -> Sống sót nhưng mất quyền thắng, cả bàn xáo bài chia lại ván mới với ổ đạn đã tăng mức nguy hiểm!
2. **Chiến Thắng Bằng Bắn Súng Sinh Tồn (`Last Survivor Victory`)**:
   - Bất kỳ lúc nào trong ván đấu, các pha hô `LẬT BÀI!` đều kích hoạt súng lục 6 ngăn. Nếu các đối thủ lần lượt trúng đạn (`ĐOÀNG!`) và chỉ còn duy nhất 1 người sống sót trên bàn, người đó giành **Chiến Thắng Tuyệt Đối** (`LAST_SURVIVOR_VICTORY`).

### 2.2. Chế Độ Tùy Chọn 2: `SINH TỬ CỔ ĐIỂN — LAST MAN STANDING` (`CLASSIC_SURVIVAL`)
- Giống bản gốc *Liar's Bar*: Ai đánh hết 5 lá bài trước sẽ được tính là **An Toàn (`Safe`)** trong ván đó. Những người còn bài tiếp tục đấu trí cho tới khi có người hô `LẬT BÀI!` hoặc người cuối cùng còn bài bị ép xét bài. Ván đấu lặp lại qua nhiều vòng cho đến khi 3 người gục ngã bởi súng lục.

---

## 3. Thiết Kế Giao Diện 2D Pixel Online Web Version

### 3.1. Kiến Trúc Trải Nghiệm Web Trực Tuyến (`Online Web Version UX`)
1. **Vào Chơi Tức Thì (`Instant Web Play`)**: Không bắt đăng ký tài khoản rườm rà; chỉ cần nhập biệt danh, chọn nhân vật Pixel và bấm **Chơi Ngay** hoặc **Tạo Phòng**.
2. **Sảnh Phòng Trực Quan (`Public Room Browser & Room Config`)**:
   - Hiển thị danh sách các bàn đang mở với tên phòng quán rượu (*Quán Rượu Cáo Già*, *Bàn Tử Thần #202*, *Bàn Sinh Tử #303*), chế độ chơi, số người, và nút vào bàn 1 chạm.
   - Modal **Tạo Phòng Tùy Chỉnh** cho phép chọn: Chế độ thắng (*Đánh Hết Bài Thắng* vs *Sinh Tử Cổ Điển*), Bật/Tắt lá *Ác Quỷ (Devil Card)*, Độ khó AI, và Hạt giống ngẫu nhiên (*Seed*).
3. **Bố Cục Bàn Chơi 2D Pixel Đối Xứng & Thông Tin Minh Bạch**:
   - Góc nhìn trực diện bàn chơi với vị trí người chơi chính ở cạnh dưới màn hình (các lá bài lớn, dễ bấm chọn 1–3 lá trên cả PC và Mobile) và 3 đối thủ ở Trái – Trên – Phải.
   - Thanh trạng thái đầu trang hiển thị rõ: **Bàn Bài Hiện Tại (`BÀN K / Q / A`)**, Số lá trên tụ bài giữa bàn, Khẩu hiệu tố vừa đánh, và tỉ lệ đạn trong súng lục (`0/6` đến `5/6`).
4. **Tương Tác Tâm Lý Thời Gian Thực (`Quick Chat & Biểu Cảm`)**:
   - Nút **Chat Nhanh** hiển thị bong bóng thoại Pixel ngay trên đầu nhân vật (*"Tin tôi đi, toàn bài chuẩn!"*, *"Lật thử xem ai nổ súng?"*, *"Tay bắt đầu run rồi đấy..."*).
5. **Nhật Ký Ván Đấu (`Match Log`) & Bảng Luật Chơi (`Rules Modal`)**:
   - Bảng nhật ký ghi lại minh bạch từng nước đi, từng lá bài vừa lật và kết quả bóp cò (`CẠCH` / `ĐOÀNG`) để người chơi dễ dàng đếm bài (Card Counting).

### 3.2. Định Hướng Mỹ Thuật 2D Pixel Art (`Retro Tavern Pixel Aesthetic`)
- **Bảng Màu Quán Rượu Ngầm Cổ Điển**:
  - Nền quán rượu tối ấm (`#120d0a`, `#1f1510`), mặt bàn gỗ sồi & nỉ xanh rêu cổ điển (`#1b3b2b`, viền gỗ `#5c3a21`), chữ vàng đồng (`#f4b41b`), đỏ máu cảnh báo (`#e03c3c`), xanh ngọc lục bảo (`#3cd070`).
- **4 Nhân Vật Pixel Art Động (`Procedural Pixel Sprite Renderer`)**:
  - **Bạn (`Tay Chơi Bí Ẩn`)**: Đội mũ phớt cổ điển.
  - **Cáo Già (`Foxy — Hệ Tính Toán`)**: Đếm bài chuẩn xác, chỉ lật tẩy khi xác suất thắng cao.
  - **Sói Độc (`Wolf — Hệ Liều Lĩnh`)**: Rất thích tố láo 2–3 lá để dồn ép đối phương.
  - **Heo Ngầu (`Bristle — Hệ Cẩn Trọng`)**: Ưu tiên đánh bài thật và cảnh giác cao khi đối thủ sắp hết bài.
  - Mỗi nhân vật có 6 trạng thái biểu cảm Pixel: *Bình tĩnh (`neutral`)*, *Cười nửa miệng (`smirk`)*, *Đổ mồ hôi (`sweat`)*, *Hốt hoảng (`shock`)*, *Chiến thắng (`victory`)*, và *Gục ngã (`dead`)*.
- **Âm Thanh 8-Bit Tổng Hợp (`Web Audio API Synthesizer`)**:
  - Tạo hiệu ứng âm thanh Chiptune/Retro trực tiếp bằng xung vuông/tam giác và nhiễu trắng (tiếng chia bài, đặt bài, còi báo động Lật Bài, tiếng xoay ổ đạn lạch cạch, tiếng cò súng khô khốc `CẠCH!`, tiếng nổ ầm vang `ĐOÀNG!` kèm rung màn hình, và nhạc hiệu chiến thắng).
