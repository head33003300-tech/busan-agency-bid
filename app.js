import { app, db } from "./firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getMessaging,
  getToken,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

const listEl = document.getElementById("noticeList");
const closedListEl = document.getElementById("closedList");
const searchInput = document.getElementById("searchInput");
const typeFilter = document.getElementById("typeFilter");

const todaySection = document.getElementById("todaySection");
const todayList = document.getElementById("todayList");
const extendedSection = document.getElementById("extendedSection");
const extendedList = document.getElementById("extendedList");
const dueSoonSection = document.getElementById("dueSoonSection");
const dueSoonList = document.getElementById("dueSoonList");

const detailModal = document.getElementById("detailModal");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

let allNotices = [];
let noticesById = new Map();

function todayStr() {
  const d = new Date();
  return (
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0")
  );
}

function daysUntilClose(closeAt) {
  if (!closeAt) return null;
  const datePart = String(closeAt).slice(0, 10).replace(/[^0-9]/g, "");
  if (datePart.length < 8) return null;
  const y = Number(datePart.slice(0, 4));
  const m = Number(datePart.slice(4, 6));
  const d = Number(datePart.slice(6, 8));
  const close = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((close - now) / 86400000);
}

function formatAddedTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatAmount(n) {
  if (!n) return null;
  const num = Number(n);
  if (Number.isNaN(num)) return n;
  return num.toLocaleString("ko-KR") + "원";
}

function cardHtml(n) {
  const isToday = n.firstSeenAt === todayStr();
  return `
    <article class="notice-card" data-bidno="${n.bidNtceNo}">
      <span class="badge">${n.type || "기타"}</span>
      ${n.regionScope ? `<span class="badge">${n.regionScope}</span>` : ""}
      ${isToday ? `<span class="badge new">오늘신규${n.firstSeenTime ? ` · ${formatAddedTime(n.firstSeenTime)} 추가` : ""}</span>` : ""}
      ${n.isExtended ? '<span class="badge new">연장</span>' : ""}
      <h3>${n.title}</h3>
      <div class="meta">
        <span>${n.org || "기관명 미상"}</span>
        <span>공고일 ${n.postedAt || "-"}</span>
        <span>마감일 ${n.closeAt || "-"}</span>
      </div>
    </article>
  `;
}

function openModal(bidNtceNo) {
  const n = noticesById.get(bidNtceNo);
  if (!n) return;

  const amount = formatAmount(n.baseAmount);

  modalBody.innerHTML = `
    <h3>${n.title}</h3>
    <div class="modal-row"><span class="label">기관</span><span class="value">${n.org || "-"}</span></div>
    <div class="modal-row"><span class="label">업무구분</span><span class="value">${n.type || "-"}</span></div>
    <div class="modal-row"><span class="label">지역구분</span><span class="value">${n.regionScope || "-"}${n.region ? ` (${n.region})` : ""}</span></div>
    <div class="modal-row"><span class="label">계약방법</span><span class="value">${n.bidMethod || "-"}</span></div>
    <div class="modal-row"><span class="label">공고일</span><span class="value">${n.postedAt || "-"}</span></div>
    <div class="modal-row"><span class="label">마감일</span><span class="value">${n.closeAt || "-"}</span></div>
    ${amount ? `<div class="modal-row"><span class="label">추정가격</span><span class="value">${amount}</span></div>` : ""}
    ${n.detailUrl ? `<a class="modal-link-btn" href="${n.detailUrl}" target="_blank" rel="noopener">나라장터 원문 공고 열기 →</a>` : ""}
  `;
  detailModal.style.display = "flex";
}

function closeModal() {
  detailModal.style.display = "none";
}

modalClose.addEventListener("click", closeModal);
detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) closeModal();
});

function attachCardClickHandler(containerEl) {
  containerEl.addEventListener("click", (e) => {
    const card = e.target.closest(".notice-card");
    if (!card) return;
    openModal(card.dataset.bidno);
  });
}
[listEl, closedListEl, todayList, extendedList, dueSoonList].forEach(attachCardClickHandler);

function renderSection(sectionEl, listEl, items) {
  if (items.length === 0) {
    sectionEl.style.display = "none";
    return;
  }
  sectionEl.style.display = "block";
  listEl.innerHTML = items.map(cardHtml).join("");
}

function render() {
  const keyword = searchInput.value.trim().toLowerCase();
  const type = typeFilter.value;

  const openNotices = allNotices.filter((n) => {
    const d = daysUntilClose(n.closeAt);
    return d === null || d >= 0;
  });
  const closedNotices = allNotices.filter((n) => {
    const d = daysUntilClose(n.closeAt);
    return d !== null && d < 0;
  });

  const todayItems = openNotices.filter((n) => n.firstSeenAt === todayStr());
  const extendedItems = openNotices.filter((n) => n.isExtended);
  const dueSoonItems = openNotices.filter((n) => {
    const d = daysUntilClose(n.closeAt);
    return d !== null && d >= 0 && d <= 3;
  });

  renderSection(todaySection, todayList, todayItems);
  renderSection(extendedSection, extendedList, extendedItems);
  renderSection(dueSoonSection, dueSoonList, dueSoonItems);

  const filtered = openNotices.filter((n) => {
    const matchesKeyword =
      !keyword ||
      n.title.toLowerCase().includes(keyword) ||
      n.org.toLowerCase().includes(keyword);
    const matchesType = !type || n.type === type;
    return matchesKeyword && matchesType;
  });

  listEl.innerHTML =
    filtered.length === 0
      ? `<p class="empty">표시할 공고가 없습니다.</p>`
      : filtered.map(cardHtml).join("");

  const sortedClosed = [...closedNotices].sort((a, b) => {
    const da = daysUntilClose(a.closeAt) ?? -Infinity;
    const db_ = daysUntilClose(b.closeAt) ?? -Infinity;
    return db_ - da;
  });

  closedListEl.innerHTML =
    sortedClosed.length === 0
      ? `<p class="empty">마감된 공고가 없습니다.</p>`
      : sortedClosed.map(cardHtml).join("");
}

const q = query(collection(db, "notices"), orderBy("closeAt", "asc"));

onSnapshot(q, (snapshot) => {
  allNotices = snapshot.docs.map((doc) => doc.data());
  noticesById = new Map(allNotices.map((n) => [n.bidNtceNo, n]));
  render();
});

const lastCheckedEl = document.getElementById("lastChecked");
onSnapshot(doc(db, "meta", "status"), (snap) => {
  if (!snap.exists() || !lastCheckedEl) return;
  const data = snap.data();
  if (!data.lastCheckedAt) return;
  const d = new Date(data.lastCheckedAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  lastCheckedEl.textContent = `마지막 조회: ${hh}:${mm}:${ss}`;
});

searchInput.addEventListener("input", render);
typeFilter.addEventListener("change", render);

// ── 서비스워커 등록 (PWA 설치 조건 충족 + 알림 등록에 재사용) ──
let swRegistration = null;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/firebase-messaging-sw.js")
    .then((reg) => {
      swRegistration = reg;
    })
    .catch((err) => console.error("서비스워커 등록 실패:", err));
}

// ── 앱으로 설치하기 (PWA, 조건 충족 시에만 브라우저가 이벤트를 줌) ──
const installBtn = document.getElementById("installBtn");
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (installBtn) installBtn.style.display = "block";
});

if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.style.display = "none";
  });
}

window.addEventListener("appinstalled", () => {
  if (installBtn) installBtn.style.display = "none";
});

// ── 새 공고 알림 받기 ──────────────────────────────────
const VAPID_KEY =
  "BC3HRjI4WdXHRPZG6Cy4iOGkG_8NIky_EKDHiZNZ_5QycROvJMyW9opS_tdTgUZOhKTbAgoyEk2mg7wVGX9Heyk";
const notifyBtn = document.getElementById("notifyBtn");

if (notifyBtn) {
  notifyBtn.addEventListener("click", async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      alert("이 브라우저는 알림 기능을 지원하지 않습니다.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        alert("알림 권한이 허용되지 않았습니다.");
        return;
      }
      const registration = swRegistration || (await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js"
      ));
      await navigator.serviceWorker.ready;
      const messaging = getMessaging(app);
      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      if (!token) {
        alert("알림 등록에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      await setDoc(doc(db, "subscribers", token), {
        token,
        subscribedAt: new Date().toISOString(),
      });
      notifyBtn.textContent = "🔔 알림 받는 중";
      notifyBtn.disabled = true;
    } catch (err) {
      console.error(err);
      alert("알림 설정 중 오류가 발생했습니다.");
    }
  });
}