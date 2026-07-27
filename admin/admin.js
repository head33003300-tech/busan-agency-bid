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
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const auth = getAuth(app);

const loginBox = document.getElementById("loginBox");
const adminPanel = document.getElementById("adminPanel");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const noticeForm = document.getElementById("noticeForm");
const tableBody = document.getElementById("noticeTableBody");

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

noticeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const today = new Date();
  const todayStr =
    today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");

  const notice = {
    title: document.getElementById("title").value,
    org: document.getElementById("org").value,
    type: document.getElementById("type").value,
    postedAt: document.getElementById("postedAt").value || null,
    closeAt: document.getElementById("closeAt").value || null,
    detailUrl: document.getElementById("detailUrl").value || null,
    source: "manual",
    firstSeenAt: todayStr,
    isExtended: false,
    updatedAt: new Date().toISOString(),
  };
  await addDoc(collection(db, "notices"), notice);
  noticeForm.reset();
});

function subscribeNotices() {
  const q = query(collection(db, "notices"), orderBy("closeAt", "asc"));
  onSnapshot(q, (snapshot) => {
    tableBody.innerHTML = snapshot.docs
      .map((d) => {
        const n = d.data();
        return `
        <tr>
          <td>${n.title}</td>
          <td>${n.org || ""}</td>
          <td>${n.type || ""}</td>
          <td>${n.closeAt || "-"}</td>
          <td class="row-actions"><button data-id="${d.id}">삭제</button></td>
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
  });
}