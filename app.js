import { db } from "./firebase-config.js";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const listEl = document.getElementById("noticeList");
const searchInput = document.getElementById("searchInput");
const typeFilter = document.getElementById("typeFilter");
const regionFilter = document.getElementById("regionFilter");

let allNotices = [];

function render() {
  const keyword = searchInput.value.trim().toLowerCase();
  const type = typeFilter.value;
  const regionScope = regionFilter.value;

  const filtered = allNotices.filter((n) => {
    const matchesKeyword =
      !keyword ||
      n.title.toLowerCase().includes(keyword) ||
      n.org.toLowerCase().includes(keyword);
    const matchesType = !type || n.type === type;
    const matchesRegion = !regionScope || n.regionScope === regionScope;
    return matchesKeyword && matchesType && matchesRegion;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="empty">표시할 공고가 없습니다.</p>`;
    return;
  }

  listEl.innerHTML = filtered
    .map(
      (n) => `
    <article class="notice-card">
      <span class="badge">${n.type || "기타"}</span>
      ${n.regionScope ? `<span class="badge">${n.regionScope}</span>` : ""}
      ${n.isToday ? '<span class="badge new">오늘추가</span>' : ""}
      <h3>${n.detailUrl ? `<a href="${n.detailUrl}" target="_blank" rel="noopener">${n.title}</a>` : n.title}</h3>
      <div class="meta">
        <span>${n.org || "기관명 미상"}</span>
        <span>공고일 ${n.postedAt || "-"}</span>
        <span>마감일 ${n.closeAt || "-"}</span>
      </div>
    </article>
  `
    )
    .join("");
}

const q = query(collection(db, "notices"), orderBy("closeAt", "asc"));

onSnapshot(q, (snapshot) => {
  allNotices = snapshot.docs.map((doc) => doc.data());
  render();
});

searchInput.addEventListener("input", render);
typeFilter.addEventListener("change", render);
regionFilter.addEventListener("change", render);
