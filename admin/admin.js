import { app, db } from "../firebase-config.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const auth = getAuth(app);

const loginBox = document.getElementById("loginBox");
const adminPanel = document.getElementById("adminPanel");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const noticeForm = document.getElementById("noticeForm");
const tableBody = document.getElementById("noticeTableBody");
const formTitle = document.getElementById("formTitle");
const formSubmitBtn = document.getElementById("formSubmitBtn");
const formCancelBtn = document.getElementById("formCancelBtn");
let editingId = null; // null이면 신규 추가 모드, 값이 있으면 그 문서를 수정 중

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = "로그인 실패: " + err.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginBox.style.display = "none";
    adminPanel.style.display = "block";
    subscribeNotices();
  } else {
    loginBox.style.display = "block";
    adminPanel.style.display = "none";
  }
});

function resetForm() {
  noticeForm.reset();
  editingId = null;
  formTitle.textContent = "공고 수동 추가";
  formSubmitBtn.textContent = "추가";
  formCancelBtn.style.display = "none";
}

formCancelBtn.addEventListener("click", resetForm);

noticeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const today = new Date();
  const todayStr =
    today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");

  const baseAmountRaw = document.getElementById("baseAmount").value;

  if (editingId) {
    await setDoc(
      doc(db, "notices", editingId),
      {
        title: document.getElementById("title").value,
        org: document.getElementById("org").value,
        type: document.getElementById("type").value,
        postedAt: document.getElementById("postedAt").value || null,
        closeAt: document.getElementById("closeAt").value || null,
        baseAmount: baseAmountRaw ? Number(baseAmountRaw) : null,
        detailUrl: document.getElementById("detailUrl").value || null,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    resetForm();
    return;
  }

  const notice = {
    title: document.getElementById("title").value,
    org: document.getElementById("org").value,
    type: document.getElementById("type").value,
    postedAt: document.getElementById("postedAt").value || null,
    closeAt: document.getElementById("closeAt").value || null,
    baseAmount: baseAmountRaw ? Number(baseAmountRaw) : null,
    detailUrl: document.getElementById("detailUrl").value || null,
    source: "manual",
    firstSeenAt: todayStr,
    isExtended: false,
    updatedAt: new Date().toISOString(),
  };
  await addDoc(collection(db, "notices"), notice);
  noticeForm.reset();
});

// ── 엑셀 일괄 등록 ─────────────────────────────────────
const excelFileInput = document.getElementById("excelFile");
const excelUploadBtn = document.getElementById("excelUploadBtn");
const excelStatus = document.getElementById("excelStatus");

function parsePostedCloseCell(raw) {
  if (!raw) return { postedAt: null, closeAt: null };
  const str = String(raw).trim();
  const m = str.match(/^(.+?)\((.+?)\)$/);
  const toStd = (s) => {
    const t = s.trim().replace(/\//g, "-");
    return /:\d{2}$/.test(t) ? `${t}:00` : t;
  };
  if (m) {
    return { postedAt: toStd(m[1]), closeAt: toStd(m[2]) };
  }
  return { postedAt: toStd(str), closeAt: null };
}

function normalizeType(raw) {
  const s = String(raw || "");
  if (s.includes("용역")) return "용역";
  if (s.includes("공사")) return "공사";
  if (s.includes("물품")) return "물품";
  if (s.includes("외자")) return "외자";
  return s || "기타";
}

function buildDetailUrl(bidNtceNo) {
  const parts = String(bidNtceNo).split("-");
  if (parts.length < 2) return null;
  const [no, ord] = parts;
  return `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${no}&bidPbancOrd=${ord}`;
}

excelUploadBtn.addEventListener("click", async () => {
  const file = excelFileInput.files[0];
  if (!file) {
    excelStatus.textContent = "먼저 엑셀 파일을 선택해주세요.";
    return;
  }
  excelStatus.textContent = "읽는 중...";

  try {
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

    const headerIdx = rows.findIndex((r) => r.includes("입찰공고번호"));
    if (headerIdx === -1) {
      excelStatus.textContent = "형식을 인식하지 못했어요. g2b.go.kr에서 받은 원본 그대로 업로드해주세요.";
      return;
    }
    const header = rows[headerIdx];
    const col = (name) => header.indexOf(name);
    const idx = {
      type: col("업무구분"),
      bidNtceNo: col("입찰공고번호"),
      title: col("공고명"),
      ntceInsttNm: col("공고기관"),
      dminsttNm: col("수요기관"),
      dateCell: col("게시일시(입찰마감일시)"),
    };

    const dataRows = rows.slice(headerIdx + 1).filter((r) => r[idx.bidNtceNo]);

    let successCount = 0;
    const today = new Date();
    const todayStr =
      today.getFullYear() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

    for (const row of dataRows) {
      const bidNtceNo = String(row[idx.bidNtceNo]).trim();
      if (!bidNtceNo) continue;
      const { postedAt, closeAt } = parsePostedCloseCell(row[idx.dateCell]);
      const ntce = row[idx.ntceInsttNm] || "";
      const dm = row[idx.dminsttNm] || "";

      await setDoc(
        doc(db, "notices", bidNtceNo),
        {
          bidNtceNo,
          type: normalizeType(row[idx.type]),
          title: row[idx.title] || "",
          org: ntce || dm,
          ntceInsttNm: ntce,
          dminsttNm: dm,
          postedAt,
          closeAt,
          detailUrl: buildDetailUrl(bidNtceNo),
          source: "manual-excel",
          firstSeenAt: todayStr,
          firstSeenTime: new Date().toISOString(),
          isExtended: false,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      successCount += 1;
    }

    excelStatus.textContent = `${successCount}건 등록 완료 (총 ${dataRows.length}건 중)`;
    excelFileInput.value = "";
  } catch (err) {
    console.error(err);
    excelStatus.textContent = "업로드 중 오류가 발생했어요: " + err.message;
  }
});

let allNoticeDocs = []; // { id, data } 형태로 최신 전체 목록 보관
const adminSearch = document.getElementById("adminSearch");
adminSearch.addEventListener("input", renderTable);

function renderTable() {
  const keyword = adminSearch.value.trim().toLowerCase();
  const filtered = keyword
    ? allNoticeDocs.filter(
        ({ data: n }) =>
          (n.title || "").toLowerCase().includes(keyword) ||
          (n.org || "").toLowerCase().includes(keyword)
      )
    : allNoticeDocs;

  tableBody.innerHTML = filtered
    .map(({ id, data: n }) => {
      const amountDisplay = n.baseAmount ? Number(n.baseAmount).toLocaleString("ko-KR") : "-";
      return `
      <tr>
        <td>${n.title}</td>
        <td>${n.org || ""}</td>
        <td>${n.type || ""}</td>
        <td>${amountDisplay}</td>
        <td>${n.closeAt || "-"}</td>
        <td class="row-actions">
          <button data-edit-id="${id}" style="background:var(--navy-500);">수정</button>
          <button data-id="${id}">삭제</button>
        </td>
      </tr>`;
    })
    .join("");

  tableBody.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (confirm("삭제하시겠습니까?")) {
        await deleteDoc(doc(db, "notices", btn.dataset.id));
      }
    });
  });

  tableBody.querySelectorAll("button[data-edit-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const found = allNoticeDocs.find((d) => d.id === btn.dataset.editId);
      if (!found) return;
      const n = found.data;

      editingId = found.id;
      document.getElementById("title").value = n.title || "";
      document.getElementById("org").value = n.org || "";
      document.getElementById("type").value = n.type || "물품";
      document.getElementById("postedAt").value = (n.postedAt || "").slice(0, 10);
      document.getElementById("closeAt").value = (n.closeAt || "").slice(0, 10);
      document.getElementById("baseAmount").value = n.baseAmount || "";
      document.getElementById("detailUrl").value = n.detailUrl || "";

      formTitle.textContent = "공고 수정";
      formSubmitBtn.textContent = "저장";
      formCancelBtn.style.display = "block";
      noticeForm.scrollIntoView({ behavior: "smooth" });
    });
  });
}

function subscribeNotices() {
  const q = query(collection(db, "notices"), orderBy("closeAt", "asc"));
  onSnapshot(q, (snapshot) => {
    allNoticeDocs = snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderTable();
  });
}