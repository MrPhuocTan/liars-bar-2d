# Liar's Bar 2D — Online Web Version (Pixel Edition)

Phiên bản **2D Pixel Art (Online Web Version)** của trò chơi tâm lý **Liar's Bar (Liar's Deck — Bài Nói Dối)** kết hợp cơ chế **Đánh Hết Bài Là Thắng (`Empty-Hand Win`)** và **Súng Lục Cò Quay Nga 6 Ngăn (`Russian Roulette 1/6 → 6/6`)**.

---

## Tính Năng Nổi Bật

1. **Bộ Bài 20 Lá Chuẩn & Biến Thể Ác Quỷ (`Devil Card`)**:
   - **Bộ chuẩn**: `6 lá K (Già)`, `6 lá Q (Đầm)`, `6 lá A (Át)`, `2 lá Joker` (Wildcard — luôn tính là bài thật).
   - **Biến thể Ác Quỷ (`Devil`)**: `6 K`, `6 Q`, `6 A`, `1 Joker`, `1 Devil (D)` (chỉ được đánh đơn lẻ 1 lá; nếu đối phương hô *Lật Bài*, toàn bộ người chơi khác trên bàn đều phải bóp cò!).
2. **Hai Chế Độ Chiến Thắng**:
   - **Đánh Hết Bài Là Thắng + Bắn Súng Lục (`EMPTY_HAND_WIN` — Mặc định)**:
     - Khi một người chơi đánh hết bài trên tay (`0 lá`), người kế tiếp bước vào **Cơ Hội Xét Bài Cuối (`FINAL_CHALLENGE_WINDOW`)**.
     - Nếu đối phương chọn **Cho Qua** hoặc hô **Lật Bài** nhưng loạt bài cuối là **Thật 100%**, người đánh hết bài **thắng ngay lập tức**!
     - Nếu loạt bài cuối bị bắt quả tang là **Nói Dối**, chiến thắng bị chặn đứng và kẻ nói dối phải rút súng lục Cò Quay Nga tự bắn!
     - Bất cứ lúc nào chỉ còn 1 người sống sót sau các pha nổ súng (`ĐOÀNG!`), người đó cũng giành chiến thắng tuyệt đối.
   - **Sinh Tử Cổ Điển (`CLASSIC_SURVIVAL`)**: Đánh hết bài thì an toàn qua vòng, đấu nhiều ván liên tiếp cho đến khi chỉ còn 1 người sống sót.
3. **Đồ Họa 2D Pixel Art & Âm Thanh 8-Bit WebAudio**:
   - Render trực tiếp trên `HTML5 2D Canvas` (`image-rendering: pixelated`) với 4 nhân vật Pixel có biểu cảm động (`neutral`, `smirk`, `sweat`, `shock`, `victory`, `dead`), hiệu ứng lật bài, xoay ổ đạn 6 ngăn và chớp lửa đầu nòng.
   - Bộ tổng hợp âm thanh 8-Bit (`Web Audio API`) không phụ thuộc file âm thanh ngoài.
4. **Sảnh Phòng Trực Tuyến, Tạo Bàn & 3 Hệ AI Đếm Bài**:
   - Tùy chỉnh tên phòng, nhân vật, chế độ chơi, độ khó AI (*Cáo Già — Hệ Tính Toán*, *Sói Độc — Hệ Liều Lĩnh*, *Heo Ngầu — Hệ Đa Nghi*) và chat nhanh tâm lý chiến.

---

## Cài Đặt & Chạy Trò Chơi

Yêu cầu: **Node.js `>= 18`** (không cần cài đặt thư viện ngoài).

```bash
# Chạy máy chủ web tại http://127.0.0.1:3000
npm start

# Chạy toàn bộ bộ kiểm thử tự động (Engine + AI + HTTP REST API)
npm test
```

---

## Cấu Trúc Thư Mục

- `server.js` — HTTP Server & JSON REST API (`/api/health`, `/api/rooms`, `/api/match/new`, `/api/match/state`, `/api/match/action`).
- `src/engine/gameEngine.js` — Máy trạng thái tất định (20-card deck, Empty-Hand Win, Final Challenge Window, 6-chamber Russian Roulette).
- `src/engine/aiBot.js` — Thuật toán AI chiến thuật và đếm bài.
- `public/` — Giao diện 2D Pixel Art (`index.html`, `css/pixel-style.css`, `js/pixelRenderer.js`, `js/soundFX.js`, `js/app.js`).
- `docs/LIARS_BAR_RESEARCH_AND_DESIGN.md` — Tài liệu nghiên cứu & thiết kế chi tiết.
- `tests/engine.test.js` — Bộ unit test & integration test (`node --test`).
