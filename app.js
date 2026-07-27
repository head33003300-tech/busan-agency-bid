import { db } from "./firebase-config.js";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

let allNotices = [];

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

function cardHtml(n) {
  return `
    <article class="notice-card">
      <span class="badge">${n.type || "기타"}</span>
      ${n.regionScope ? `<span class="badge">${n.regionScope}</span>` : ""}
      ${n.firstSeenAt === todayStr() ? '<span class="badge new">오늘신규</span>' : ""}
      ${n.isExtended ? '<span class="badge new">연장</span>' : ""}
      <h3>${n.detailUrl ? `<a href="${n.detailUrl}" target="_blank" rel="noopener">${n.title}</a>` : n.title}</h3>
      <div class="meta">
        <span>${n.org || "기관명 미상"}</span>
        <span>공고일 ${n.postedAt || "-"}</span>
        <span>마감일 ${n.closeAt || "-"}</span>
      </div>
    </article>
  `;
}

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
  render();
});

searchInput.addEventListener("input", render);
typeFilter.addEventListener("change", render);