/**
 * 부산지역 공기업/공공기관 사업공고 자동 수집 스크립트 (GitHub Actions용)
 *
 * 일반 HTTP 클라이언트(fetch/https)로는 나라장터 API가 계속 500 "Unexpected errors"를
 * 반환해서(WAF가 비브라우저 요청을 차단하는 것으로 추정), Puppeteer로 실제 Chromium
 * 브라우저를 띄워 요청하도록 변경한 버전입니다.
 *
 * 필요한 환경변수:
 *   NARA_API_KEY              : data.go.kr 나라장터 입찰공고정보서비스 인증키
 *   FIREBASE_SERVICE_ACCOUNT  : Firebase 서비스 계정 키(JSON) 전체 내용
 */

const admin = require("firebase-admin");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const NARA_API_KEY = process.env.NARA_API_KEY;
const SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!NARA_API_KEY) {
  console.error("NARA_API_KEY 환경변수가 없습니다.");
  process.exit(1);
}
if (!SERVICE_ACCOUNT_JSON) {
  console.error("FIREBASE_SERVICE_ACCOUNT 환경변수가 없습니다.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(SERVICE_ACCOUNT_JSON)),
});
const db = admin.firestore();

const BASE_URL = "https://apis.data.go.kr/1230000/BidPublicInfoService";

const OPERATIONS = [
  { type: "물품", path: "getBidPblancListInfoThng" },
  { type: "공사", path: "getBidPblancListInfoCnstwk" },
  { type: "용역", path: "getBidPblancListInfoServc" },
];

const BUSAN_KEYWORDS = ["부산", "Busan", "부산광역시", "부산시"];

function isBusanRelated(item) {
  const participationRegion =
    (item.prtcptPsblRgnNm || "") + "" + (item.rgnLmtBidLocplcJdgmBssNm || "");
  const hasNoRegionLimit =
    participationRegion.trim() === "" || participationRegion.includes("전국");
  return hasNoRegionLimit || BUSAN_KEYWORDS.some((kw) => participationRegion.includes(kw));
}

function toNoticeDoc(item, type) {
  const participationRegion =
    (item.prtcptPsblRgnNm || "") + "" + (item.rgnLmtBidLocplcJdgmBssNm || "");
  const regionScope =
    participationRegion.trim() === "" || participationRegion.includes("전국")
      ? "전국(제한없음)"
      : "부산제한";

  return {
    bidNtceNo: item.bidNtceNo || null,
    type,
    title: item.bidNtceNm || "",
    org: item.ntceInsttNm || item.dminsttNm || "",
    region: item.prtcptPsblRgnNm || "",
    regionScope,
    bidMethod: item.bidMethdNm || "",
    postedAt: item.bidNtceDate || null,
    closeAt: item.bidClseDate || null,
    baseAmount: item.presmptPrce || null,
    detailUrl: item.bidNtceDtlUrl || null,
    source: "naraTerm-api",
    updatedAt: new Date().toISOString(),
  };
}

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOperation(page, op) {
  const url = `${BASE_URL}/${op.path}?serviceKey=${NARA_API_KEY}&pageNo=1&numOfRows=100&type=json&inqryDiv=1&inqryBgnDt=${todayStr()}0000&inqryEndDt=${todayStr()}2359`;

  const response = await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
  const status = response.status();
  const bodyText = await page.evaluate(() => document.body.innerText);

  if (status !== 200) {
    console.error(`나라장터 API 호출 실패 (${op.type}) ${status}`, bodyText.slice(0, 500));
    return [];
  }
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (e) {
    console.error(`나라장터 API 응답 파싱 실패 (${op.type})`, bodyText.slice(0, 500));
    return [];
  }
  const items = data?.response?.body?.items || [];
  return items.map((item) => toNoticeDoc(item, op.type)).filter(isBusanRelated);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  );

  const notices = [];
  for (const op of OPERATIONS) {
    const result = await fetchOperation(page, op);
    notices.push(...result);
    console.log(`${op.type} 조회 완료: ${result.length}건`);
    await sleep(500);
  }

  await browser.close();

  if (notices.length === 0) {
    console.log("신규/해당 공고 없음");
    return;
  }

  const refs = notices
    .filter((n) => n.bidNtceNo)
    .map((n) => db.collection("notices").doc(n.bidNtceNo));
  const existingSnaps = refs.length ? await db.getAll(...refs) : [];
  const existingMap = new Map(
    existingSnaps.map((snap) => [snap.id, snap.exists ? snap.data() : null])
  );

  const today = todayStr();
  const batch = db.batch();
  for (const notice of notices) {
    if (!notice.bidNtceNo) continue;
    const ref = db.collection("notices").doc(notice.bidNtceNo);
    const existing = existingMap.get(notice.bidNtceNo);

    let extra;
    if (!existing) {
      extra = { firstSeenAt: today, isExtended: false };
    } else {
      const closeChanged =
        existing.closeAt && notice.closeAt && existing.closeAt !== notice.closeAt;
      extra = {
        firstSeenAt: existing.firstSeenAt || today,
        isExtended: !!existing.isExtended || !!closeChanged,
      };
    }

    batch.set(ref, { ...notice, ...extra }, { merge: true });
  }
  await batch.commit();

  console.log(`${notices.length}건 처리 완료`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});