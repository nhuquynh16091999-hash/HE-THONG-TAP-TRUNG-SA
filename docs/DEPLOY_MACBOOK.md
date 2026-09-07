# Chạy dashboard trên Macbook, mở ra ngoài bằng Cloudflare Tunnel

Cách này **mọi tính năng chạy đủ** vì ổ đĩa ghi được — không phải sửa dòng code
nào, không phải thuê máy chủ. Đổi lại: **máy phải luôn bật và luôn có mạng**.

---

## Đang chạy gì

Ba tiến trình dưới pm2, khai trong `ops/pm2/ecosystem.mac.config.js`:

| Tên | Việc | Tắt thì sao |
|---|---|---|
| `talpha-dashboard` | Next.js ở cổng 3000 | không còn dashboard |
| `talpha-tunnel` | đưa cổng 3000 ra địa chỉ web | truy cập từ xa đứt, ở máy vẫn vào được |
| `talpha-awake` | giữ máy không ngủ | **máy ngủ là cả đội mất dashboard** |

Máy này đang đặt tự ngủ sau 1 phút, nên `talpha-awake` không phải cho vui. Nó dùng
`caffeinate` — giữ máy thức mà không cần mật khẩu quản trị. Màn hình vẫn được tắt.

---

## Lệnh hằng ngày

```bash
pm2 list                      # xem cả ba còn sống không
pm2 logs talpha-dashboard     # xem log
pm2 restart talpha-dashboard  # khởi động lại sau khi sửa code
```

Sau khi sửa code, dùng đúng lệnh này — nó dựng xong mới khởi động lại:

```bash
cd dashboard-ui && npm run deploy
```

**Đừng chạy `npm run build` khi pm2 đang chạy rồi bỏ đó.** Dựng lại là mọi file
chunk đổi tên, nhưng tiến trình cũ vẫn phục vụ trang HTML trỏ vào tên cũ — trình
duyệt ném `ChunkLoadError` và người dùng thấy **màn trắng**, chẳng có thông báo gì
hiểu được. Đã dính thật. `npm run deploy` làm đúng thứ tự nên không vướng.

Người dùng đang mở sẵn trang cũ thì bảo họ tải lại trang (Cmd+Shift+R).

---

## Địa chỉ web: hai kiểu đường hầm

### Đường hầm tạm — chạy ngay, không cần tài khoản

```bash
cloudflared tunnel --url http://localhost:3000
```

In ra một địa chỉ dạng `https://<chữ-ngẫu-nhiên>.trycloudflare.com`.

**Địa chỉ đổi mỗi lần khởi động lại.** Hợp để thử, không hợp để đưa cho cả đội.

### Đường hầm có tên — địa chỉ cố định

Cần một tài khoản Cloudflare và một tên miền đã trỏ về Cloudflare.

```bash
cloudflared tunnel login                      # mở trình duyệt, chọn tên miền
cloudflared tunnel create talpha              # tạo đường hầm tên "talpha"
cloudflared tunnel route dns talpha dashboard.tenmiencuaban.com
```

Rồi tạo `~/.cloudflared/config.yml`:

```yaml
tunnel: talpha
credentials-file: /Users/macbook/.cloudflared/<id-đường-hầm>.json
ingress:
  - hostname: dashboard.tenmiencuaban.com
    service: http://localhost:3000
  - service: http_status:404
```

Xong thì bật tiến trình tunnel trong pm2 — nó gọi sẵn `cloudflared tunnel run talpha`:

```bash
pm2 start ops/pm2/ecosystem.mac.config.js --only talpha-tunnel && pm2 save
```

---

## Địa chỉ đăng nhập

`.env.local` **cố ý để trống** `NEXTAUTH_URL` và `AUTH_URL`, kèm `AUTH_TRUST_HOST=true`.

Lý do: ghi cứng `http://localhost:3000` thì ai vào qua đường hầm cũng bị đá về
máy của chính họ khi chuyển sang trang đăng nhập. Để trống thì hệ thống lấy đúng
địa chỉ người dùng đang truy cập — hợp với đường hầm tạm vốn đổi địa chỉ liên tục.

Có tên miền cố định rồi thì khai vào cho chắc.

Lời gọi kiểm mật khẩu bên trong đi thẳng `127.0.0.1` chứ không đi vòng qua địa chỉ
công khai — nhanh hơn, và đường hầm rớt thì đăng nhập tại máy vẫn chạy.

---

## Máy bật lại thì sao

`pm2 save` đã lưu danh sách tiến trình. Cài LaunchAgent để tự dựng lại khi đăng nhập:

```bash
cp ops/launchd/com.talpha.pm2-resurrect.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.talpha.pm2-resurrect.plist
```

### ⚠️ Cái bẫy lớn nhất của cách này

Dự án đang nằm trong **`~/Desktop`**. macOS bảo vệ `Desktop`, `Documents`,
`Downloads` — tiến trình do launchd khởi động **không đọc được** những thư mục đó
và chết với lỗi `EPERM`.

Đã gặp thật khi dựng: pm2 báo `EPERM: open .../next`, app dựng lên rồi chết ngay.
Lần đó chữa được bằng cách khởi động lại nền pm2 từ cửa sổ dòng lệnh có quyền,
nhưng **sau khi khởi động lại máy thì lỗi sẽ quay về**.

**Cách chắc ăn — chuyển dự án ra khỏi Desktop:**

```bash
pm2 kill
mv "/Users/macbook/Desktop/Dashboard Sỹ Anh/Talpha-New-16-6" ~/talpha
cd ~/talpha && pm2 start ops/pm2/ecosystem.mac.config.js && pm2 save
```

Đường dẫn trong `ecosystem.mac.config.js` tự suy từ vị trí file nên chuyển xong
chạy được ngay, không phải sửa gì.

**Cách khác:** cấp Full Disk Access cho `/bin/bash` và `node` trong
`Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Truy cập toàn bộ ổ đĩa`. Làm được
nhưng rườm rà và mỗi lần nâng cấp Node lại phải cấp lại.

---

## Một cái bẫy nữa đã gặp

Thư mục dự án có khoảng trắng (`Dashboard Sỹ Anh`). Khai đường dẫn **tuyệt đối**
cho `script` trong pm2 thì pm2 rơi về chạy qua `/bin/bash -c ...`, rồi lại bắt
`node` biên dịch chính `/bin/bash` như file JS — app chết với `SyntaxError` khó
hiểu, chẳng liên quan gì tới lỗi thật.

Cấu hình hiện tại dùng **đường dẫn tương đối** cộng `cwd`, nên không đi qua shell.
Đừng đổi lại thành đường dẫn tuyệt đối.

---

## Về bảo mật

Đường hầm đưa dashboard ra internet. Ai có địa chỉ đều mở được trang đăng nhập —
vào trong thì phải có tài khoản.

Nên làm thêm:

- **Đổi mật khẩu** tài khoản `talpha@levelup` — mật khẩu hiện tại từng đi qua khung chat
- **Bật Cloudflare Access** trên đường hầm có tên: chặn ngay từ cổng, người lạ
  không thấy cả trang đăng nhập. Miễn phí tới 50 người dùng.

---

## Nửa còn lại vẫn chưa có

Dashboard chỉ **đọc** số. Việc **bơm số vào** BigQuery — sync POS + Meta, báo cáo
Google Sheets — chưa có gì chạy trên máy này. Chừng nào chưa dựng, kho BigQuery
còn trống và các tab đọc BigQuery còn rỗng.

Ưu điểm của cách chạy trên Mac: nửa đó **cũng chạy được ngay trên chính máy này**
bằng launchd, giống hệ thống cũ đang làm. Cần key Poscake trước.
