// ═══════════════════════════════════════════════════════════════════
// ANTALO — service worker TỐI GIẢN cho app cài được (PWA, 06/10/2026).
//
// CỐ Ý KHÔNG lưu số liệu hay trang nào của dashboard: có đăng nhập + phân quyền theo team,
// số đổi từng giờ — lưu lại là sớm muộn hiện số cũ, hoặc tệ hơn, hiện số của tài khoản đăng
// nhập trước trên cùng máy. Việc của file này chỉ có hai:
//   1. để trình duyệt nhận đây là app cài được;
//   2. mất mạng thì hiện trang "mất kết nối" (offline.html) thay vì màn lỗi của trình duyệt.
// Đổi nội dung offline.html thì tăng số phiên bản CACHE để máy tải bản mới.
// ═══════════════════════════════════════════════════════════════════
const CACHE = "antalo-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((c) => c.addAll([OFFLINE_URL, "/icon-192.png"]))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    // Chỉ lo lượt mở trang. API, ảnh, script… để trình duyệt tự xử lý như không có service worker.
    if (event.request.mode !== "navigate") return;
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
