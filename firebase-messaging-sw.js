// FCM 백그라운드 알림용 서비스워커 (사이트 안 열려있어도 알림을 받기 위해 필요)
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCuLEfE2nTBSKhyrBH8CMaxmXISwwxiRu4",
  authDomain: "busan-agency-bid.firebaseapp.com",
  projectId: "busan-agency-bid",
  storageBucket: "busan-agency-bid.firebasestorage.app",
  messagingSenderId: "538200975842",
  appId: "1:538200975842:web:3bbb879860fe5657af31bb",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "부산 신규 공고";
  const body = payload.notification?.body || "새 공고가 등록되었습니다.";
  const vibrateOn = payload.data?.vibrate !== "false";
  const link = payload.data?.link || payload.fcmOptions?.link || "/";
  self.registration.showNotification(title, {
    body,
    ...(vibrateOn ? { vibrate: [200, 100, 200, 100, 200] } : {}),
    icon: "/icons/icon-192.png",
    data: { url: link }, // 클릭했을 때 이동할 주소를 알림 자체에 저장해둠
  });
});

// 알림을 클릭하면, 저장해둔 주소(공고 상세 모달이 자동으로 열리는 링크)로 이동/포커스함
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // 이미 열려있는 탭이 있으면 그 탭을 그 주소로 이동시키고 포커스
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // 열려있는 탭이 없으면 새 창으로 열기
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// PWA 설치(홈 화면 추가) 조건 충족을 위한 최소 fetch 핸들러 (별도 캐싱은 하지 않고 그대로 통과)
self.addEventListener("fetch", () => {});