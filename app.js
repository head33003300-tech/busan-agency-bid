import { app, db } from "./firebase-config.js";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  deleteToken,
  getMessaging,
  getToken,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

// ── 홈/서브 화면 요소 ──────────────────────────────────
const homeView = document.getElementById("homeView");
const subView = document.getElementById("subView");
const backBtn = document.getElementById("backBtn");
const subViewTitle = document.getElementById("subViewTitle");
const dashboardView = document.getElementById("dashboardView");
const simpleListView = document.getElementById("simpleListView");
const simpleListEl = document.getElementById("simpleList");
const simpleFilters = document.getElementById("simpleFilters");
const simpleSearchInput = document.getElementById("simpleSearchInput");
const simpleSearchBtn = document.getElementById("simpleSearchBtn");
const recommendControls = document.getElementById("recommendControls");
const recommendCountInput = document.getElementById("recommendCount");
const recommendApplyBtn = document.getElementById("recommendApplyBtn");
const recommendCountMsg = document.getElementById("recommendCountMsg");
const tiles = document.querySelectorAll(".tile");

const countOpenEl = document.getElementById("countOpen");
const countDueSoonEl = document.getElementById("countDueSoon");
const countTodayEl = document.getElementById("countToday");
const countClosedEl = document.getElementById("countClosed");

const listEl = document.getElementById("noticeList");
const closedListEl = document.getElementById("closedList");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

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
let currentView = null; // null이면 홈 화면
let appliedRecommendCount = 20;
let recommendApplied = false; // 조회 버튼을 한 번이라도 눌렀는지

const VIEW_TITLES = {
  open: "✅ 현재 신청 가능 사업",
  dueSoon: "⏰ 마감 임박 사업",
  today: "🔔 오늘 추가된 사업",
  closed: "🗂 종료된 사업",
  recommend: "💰 고액 사업 TOP",
};

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
  let str = String(closeAt).trim();
  // 시간 정보가 없이 날짜만 있는 경우(예: "2026-07-28")는 그날 23:59:59까지로 간주
  if (!/\d{1,2}:\d{2}/.test(str)) {
    str = str.slice(0, 10) + "T23:59:59";
  } else {
    str = str.includes("T") ? str : str.replace(" ", "T");
  }
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  return (d.getTime() - now.getTime()) / 86400000;
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
    ${n.remarks ? `<div class="modal-row"><span class="label">비고</span><span class="value">${n.remarks}</span></div>` : ""}
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
[listEl, closedListEl, todayList, extendedList, dueSoonList, simpleListEl].forEach(
  attachCardClickHandler
);

function renderSection(sectionEl, listEl, items) {
  if (items.length === 0) {
    sectionEl.style.display = "none";
    return;
  }
  sectionEl.style.display = "block";
  listEl.innerHTML = items.map(cardHtml).join("");
}

// ── 화면 전환 ──────────────────────────────────────────
// 히스토리에 상태를 남겨서, 모바일/브라우저 뒤로가기 버튼이
// 앱을 바로 종료하지 않고 이전 화면(홈)으로 돌아가도록 함
history.replaceState({ view: "home" }, "", location.pathname + location.search);

function showHome() {
  currentView = null;
  homeView.style.display = "block";
  subView.style.display = "none";
}

function showView(view, pushHistory = true) {
  currentView = view;
  homeView.style.display = "none";
  subView.style.display = "block";

  if (view === "dashboard") {
    subViewTitle.textContent = "📊 대시보드";
    dashboardView.style.display = "block";
    simpleListView.style.display = "none";
  } else {
    subViewTitle.textContent = VIEW_TITLES[view] || "";
    dashboardView.style.display = "none";
    simpleListView.style.display = "block";

    if (view === "recommend") {
      simpleFilters.style.display = "none";
      recommendControls.style.display = "block";
      // 처음으로 갔다가 다시 들어오면 이전 조회 결과는 초기화
      appliedRecommendCount = 20;
      recommendApplied = false;
      recommendCountInput.value = 20;
      recommendCountMsg.textContent = "";
    } else {
      simpleFilters.style.display = "flex";
      recommendControls.style.display = "none";
      simpleSearchInput.value = "";
    }
  }

  if (pushHistory) {
    history.pushState({ view }, "", "#" + view);
  }
  render();
}

tiles.forEach((tile) => {
  tile.addEventListener("click", () => showView(tile.dataset.view));
});

// 뒤로가기 버튼도 history.back()으로 통일 (popstate가 실제 화면 전환을 처리)
backBtn.addEventListener("click", () => history.back());

window.addEventListener("popstate", (e) => {
  const view = e.state?.view;
  if (!view || view === "home") {
    showHome();
  } else {
    showView(view, false); // 히스토리에 다시 쌓지 않음(popstate로 이미 이동한 상태)
  }
});

// ── 렌더링 ─────────────────────────────────────────────
function render() {
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
  const recommendItems = [...openNotices]
    .filter((n) => n.baseAmount && !Number.isNaN(Number(n.baseAmount)))
    .sort((a, b) => Number(b.baseAmount) - Number(a.baseAmount))
    .slice(0, appliedRecommendCount);

  const sortedClosed = [...closedNotices].sort((a, b) => {
    const da = daysUntilClose(a.closeAt) ?? -Infinity;
    const db_ = daysUntilClose(b.closeAt) ?? -Infinity;
    return db_ - da;
  });

  // 홈 화면 타일 카운트
  countOpenEl.textContent = openNotices.length;
  countDueSoonEl.textContent = dueSoonItems.length;
  countTodayEl.textContent = todayItems.length;
  countClosedEl.textContent = sortedClosed.length;

  // 대시보드 내부 (보일 때만 갱신해도 되지만 항상 갱신해도 무방)
  renderSection(todaySection, todayList, todayItems);
  renderSection(extendedSection, extendedList, extendedItems);
  renderSection(dueSoonSection, dueSoonList, dueSoonItems);

  const keyword = searchInput.value.trim().toLowerCase();
  const filtered = openNotices.filter((n) => {
    return (
      !keyword ||
      n.title.toLowerCase().includes(keyword) ||
      n.org.toLowerCase().includes(keyword)
    );
  });
  listEl.innerHTML =
    filtered.length === 0
      ? `<p class="empty">표시할 공고가 없습니다.</p>`
      : filtered.map(cardHtml).join("");

  closedListEl.innerHTML =
    sortedClosed.length === 0
      ? `<p class="empty">마감된 공고가 없습니다.</p>`
      : sortedClosed.map(cardHtml).join("");

  const viewItemsMap = {
    open: openNotices,
    dueSoon: dueSoonItems,
    today: todayItems,
    closed: sortedClosed,
  };

  if (currentView === "recommend") {
    simpleListEl.innerHTML = !recommendApplied
      ? `<div class="recommend-empty"><span class="icon">💰</span><span class="text">개수를 정하고<br />"조회" 버튼을 눌러주세요.</span></div>`
      : recommendItems.length === 0
        ? `<p class="empty">표시할 공고가 없습니다.</p>`
        : recommendItems.map(cardHtml).join("");
  } else if (currentView && viewItemsMap[currentView]) {
    const simpleKeyword = simpleSearchInput.value.trim().toLowerCase();
    const items = viewItemsMap[currentView].filter((n) => {
      return (
        !simpleKeyword ||
        n.title.toLowerCase().includes(simpleKeyword) ||
        n.org.toLowerCase().includes(simpleKeyword)
      );
    });
    simpleListEl.innerHTML =
      items.length === 0
        ? `<p class="empty">표시할 공고가 없습니다.</p>`
        : items.map(cardHtml).join("");
  }
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

searchBtn.addEventListener("click", render);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") render();
});
simpleSearchBtn.addEventListener("click", render);
simpleSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") render();
});

recommendApplyBtn.addEventListener("click", () => {
  const raw = recommendCountInput.value.trim();
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n) || n < 1) {
    recommendCountMsg.textContent = "숫자를 입력해주세요.";
    return; // 유효하지 않으면 이전 조회 결과를 그대로 유지
  }
  recommendCountMsg.textContent = "";
  appliedRecommendCount = n;
  recommendApplied = true;
  render();
});

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

// ── 새 공고 알림 받기/해제 ─────────────────────────────
const VAPID_KEY =
  "BC3HRjI4WdXHRPZG6Cy4iOGkG_8NIky_EKDHiZNZ_5QycROvJMyW9opS_tdTgUZOhKTbAgoyEk2mg7wVGX9Heyk";
const notifyBtn = document.getElementById("notifyBtn");
const notifyPrefs = document.getElementById("notifyPrefs");
const notifyKeywordsInput = document.getElementById("notifyKeywords");
const notifyVibrateInput = document.getElementById("notifyVibrate");
const notifyPrefsSaveBtn = document.getElementById("notifyPrefsSaveBtn");
const notifyPrefsMsg = document.getElementById("notifyPrefsMsg");
const SUBSCRIBED_LABEL = "🔕 알림 해제하기";
const UNSUBSCRIBED_LABEL = "🔔 새 공고 알림 받기";

function showNotifyPrefs() {
  notifyPrefs.style.display = "flex";
  notifyKeywordsInput.value = localStorage.getItem("fcmKeywords") || "";
  notifyVibrateInput.checked = localStorage.getItem("fcmVibrate") !== "false";
}

function hideNotifyPrefs() {
  notifyPrefs.style.display = "none";
}

// 이전에 이 브라우저에서 구독한 적 있으면 버튼 상태 복원
let savedToken = localStorage.getItem("fcmToken");
if (savedToken && notifyBtn) {
  notifyBtn.textContent = SUBSCRIBED_LABEL;
  showNotifyPrefs();
}

async function subscribeToNotifications() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    alert("알림 권한이 허용되지 않았습니다.");
    return;
  }
  const registration =
    swRegistration ||
    (await navigator.serviceWorker.register("/firebase-messaging-sw.js"));
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
    keywords: [],
    vibrate: true,
  });
  localStorage.setItem("fcmToken", token);
  notifyBtn.textContent = SUBSCRIBED_LABEL;
  showNotifyPrefs();
}

async function unsubscribeFromNotifications() {
  const token = localStorage.getItem("fcmToken");
  if (token) {
    await deleteDoc(doc(db, "subscribers", token)).catch(() => {});
  }
  try {
    const messaging = getMessaging(app);
    await deleteToken(messaging);
  } catch (err) {
    // 이미 만료된 토큰 등은 무시
  }
  localStorage.removeItem("fcmToken");
  localStorage.removeItem("fcmKeywords");
  notifyBtn.textContent = UNSUBSCRIBED_LABEL;
  hideNotifyPrefs();
}

if (notifyBtn) {
  notifyBtn.addEventListener("click", async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      alert("이 브라우저는 알림 기능을 지원하지 않습니다.");
      return;
    }
    notifyBtn.disabled = true;
    try {
      const isSubscribed = notifyBtn.textContent === SUBSCRIBED_LABEL;
      if (isSubscribed) {
        await unsubscribeFromNotifications();
      } else {
        await subscribeToNotifications();
      }
    } catch (err) {
      console.error(err);
      alert("알림 설정 중 오류가 발생했습니다.");
    } finally {
      notifyBtn.disabled = false;
    }
  });
}

if (notifyPrefsSaveBtn) {
  notifyPrefsSaveBtn.addEventListener("click", async () => {
    const token = localStorage.getItem("fcmToken");
    if (!token) return;
    const keywords = notifyKeywordsInput.value
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const vibrate = notifyVibrateInput.checked;
    try {
      await setDoc(doc(db, "subscribers", token), { keywords, vibrate }, { merge: true });
      localStorage.setItem("fcmKeywords", notifyKeywordsInput.value.trim());
      localStorage.setItem("fcmVibrate", String(vibrate));
      notifyPrefsMsg.textContent =
        keywords.length === 0 ? "저장됨 (전체 알림)" : `저장됨 (${keywords.length}개 키워드)`;
      setTimeout(() => (notifyPrefsMsg.textContent = ""), 3000);
    } catch (err) {
      console.error(err);
      notifyPrefsMsg.textContent = "저장 실패";
    }
  });
}