import { app, db } from "../firebase-config.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
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

// ── 비밀번호 변경 ──────────────────────────────────────
const pwChangeForm = document.getElementById("pwChangeForm");
const pwChangeMsg = document.getElementById("pwChangeMsg");

pwChangeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  pwChangeMsg.style.color = "var(--muted)";
  pwChangeMsg.textContent = "";

  const currentPw = document.getElementById("currentPw").value;
  const newPw = document.getElementById("newPw").value;
  const newPwConfirm = document.getElementById("newPwConfirm").value;

  if (newPw.length < 6) {
    pwChangeMsg.style.color = "var(--signal-due)";
    pwChangeMsg.textContent = "새 비밀번호는 6자 이상이어야 해요.";
    return;
  }
  if (newPw !== newPwConfirm) {
    pwChangeMsg.style.color = "var(--signal-due)";
    pwChangeMsg.textContent = "새 비밀번호가 서로 일치하지 않아요.";
    return;
  }

  try {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPw);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, newPw);

    pwChangeMsg.style.color = "var(--navy-700)";
    pwChangeMsg.textContent = "비밀번호가 변경되었어요.";
    pwChangeForm.reset();
  } catch (err) {
    console.error(err);
    pwChangeMsg.style.color = "var(--signal-due)";
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      pwChangeMsg.textContent = "현재 비밀번호가 맞지 않아요.";
    } else if (err.code === "auth/too-many-requests") {
      pwChangeMsg.textContent = "시도가 너무 많아요. 잠시 후 다시 시도해주세요.";
    } else {
      pwChangeMsg.textContent = "변경 실패: " + err.message;
    }
  }
});

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
  const remarksRaw = document.getElementById("remarks").value.trim();

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
        remarks: remarksRaw || null,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    resetForm();
    return;
  }

  const officialNoRaw = document.getElementById("officialNo").value.trim();
  const bidNtceNo = officialNoRaw || `MANUAL-${Date.now()}`;

  const auto = officialNoRaw
    ? autoLinkedAgencyInfo(officialNoRaw, document.getElementById("org").value)
    : { detailUrl: null, remarks: null };

  const notice = {
    bidNtceNo,
    title: document.getElementById("title").value,
    org: document.getElementById("org").value,
    type: document.getElementById("type").value,
    postedAt: document.getElementById("postedAt").value || null,
    closeAt: document.getElementById("closeAt").value || null,
    baseAmount: baseAmountRaw ? Number(baseAmountRaw) : null,
    detailUrl: document.getElementById("detailUrl").value || auto.detailUrl,
    remarks: remarksRaw || auto.remarks,
    source: "manual",
    firstSeenAt: todayStr,
    firstSeenTime: new Date().toISOString(),
    isExtended: false,
    updatedAt: new Date().toISOString(),
  };
  await setDoc(doc(db, "notices", bidNtceNo), notice);
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
  if (!/^R/i.test(bidNtceNo)) return null;
  const parts = String(bidNtceNo).split("-");
  if (parts.length < 2) return null;
  const [no, ord] = parts;
  return `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${no}&bidPbancOrd=${ord}`;
}

// 공고번호와 기관명을 보고, 연계기관(한전 그룹사 등) 공고인지 자동 판단해서
// 링크/비고를 자동으로 채워줌. 사용자가 이미 직접 입력한 값은 이 함수 결과보다 우선함.
const KEPCO_GROUP_KEYWORDS = ["한국남부발전"]; // 필요하면 다른 발전공기업도 여기에 추가

function autoLinkedAgencyInfo(bidNtceNo, org) {
  if (!bidNtceNo) return { detailUrl: null, remarks: null };
  if (/^R/i.test(bidNtceNo)) {
    return { detailUrl: buildDetailUrl(bidNtceNo), remarks: null };
  }
  const isKepcoGroup = KEPCO_GROUP_KEYWORDS.some((kw) => (org || "").includes(kw));
  const remarks = `이 공고는 발주기관 자체 조달시스템에 등록되어, 나라장터에서 별도 상세 링크를 지원하지 않습니다. 상세 열람을 희망하시는 경우 링크 접속 -> 통합검색창에 '${bidNtceNo}'로 검색 -> 빈 화면 -> 검색조건을 '공고번호'로 변경 후 재검색`;
  return {
    detailUrl: isKepcoGroup ? "https://srm.kepco.net/index.do" : null,
    remarks,
  };
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
      const remarksDisplay = n.remarks
        ? n.remarks.length > 15
          ? n.remarks.slice(0, 15) + "…"
          : n.remarks
        : "-";
      return `
      <tr>
        <td>${n.title}</td>
        <td>${n.org || ""}</td>
        <td>${n.type || ""}</td>
        <td>${amountDisplay}</td>
        <td>${n.closeAt || "-"}</td>
        <td title="${(n.remarks || "").replace(/"/g, "&quot;")}">${remarksDisplay}</td>
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
      document.getElementById("officialNo").value = n.bidNtceNo || "";
      document.getElementById("type").value = n.type || "물품";
      document.getElementById("postedAt").value = (n.postedAt || "").slice(0, 10);
      document.getElementById("closeAt").value = (n.closeAt || "").slice(0, 10);
      document.getElementById("baseAmount").value = n.baseAmount || "";
      document.getElementById("detailUrl").value = n.detailUrl || "";
      document.getElementById("remarks").value = n.remarks || "";

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