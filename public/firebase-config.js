// Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱(웹)에서 복사한 설정값으로 교체하세요.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCuLEfE2nTBSKhyrBH8CMaxmXISwwxiRu4",
  authDomain: "busan-agency-bid.firebaseapp.com",
  projectId: "busan-agency-bid",
  storageBucket: "busan-agency-bid.firebasestorage.app",
  messagingSenderId: "538200975842",
  appId: "1:538200975842:web:3bbb879860fe5657af31bb",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
