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
  self.registration.showNotification(title, {
    body,
    ...(vibrateOn ? { vibrate: [200, 100, 200, 100, 200] } : {}),
    icon: "/icons/icon-192.png",
  });
});

// PWA 설치(홈 화면 추가) 조건 충족을 위한 최소 fetch 핸들러 (별도 캐싱은 하지 않고 그대로 통과)
self.addEventListener("fetch", () => {});