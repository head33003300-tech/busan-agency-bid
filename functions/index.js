/**
 * 부산지역 공기업/공공기관 사업공고 자동 수집 Cloud Function
 *
 * - 나라장터 오픈API(입찰공고정보서비스)를 주기적으로 호출
 * - 발주기관 소재지가 부산이거나, 공고명/기관명에 부산 관련 키워드가 포함된 공고만 필터링
 * - Firestore 'notices' 컬렉션에 upsert (공고번호 기준 중복 방지)
 *
 * 환경변수(.env 또는 functions:config)로 다음 값을 설정해야 합니다.
 *   NARA_API_KEY : data.go.kr에서 발급받은 인증키(서비스키, Decoding 키 사용 권장)
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

// ── 설정 ──────────────────────────────────────────────
const NARA_API_KEY = process.env.NARA_API_KEY;
const BASE_URL = "https://apis.data.go.kr/1230000/BidPublicInfoService";

// 업무구분별 오퍼레이션 (나라장터 입찰공고정보서비스 - 입찰공고목록 조회)
const OPERATIONS = [
  { type: "물품", path: "getBidPblancListInfoThng" },
  { type: "공사", path: "getBidPblancListInfoCnstwk" },
  { type: "용역", path: "getBidPblancListInfoServc" },
];

// 부산 판별 키워드
const BUSAN_KEYWORDS = ["부산", "Busan", "부산광역시", "부산시"];

// ── 유틸 ──────────────────────────────────────────────
// "참여 가능한 기업의 소재지(참가가능지역)"가 부산이거나, 지역제한이 아예 없는(전국 대상)
// 공고를 포함함 (전국 대상 공고는 부산 기업도 참여 가능하므로 포함)
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
    bidNtceNo: item.bidNtceNo || null, // 입찰공고번호 (고유키로 사용)
    type, // 물품/공사/용역
    title: item.bidNtceNm || "",
    org: item.ntceInsttNm || item.dminsttNm || "",
    region: item.prtcptPsblRgnNm || "",
    regionScope, // "부산제한" | "전국(제한없음)"
    bidMethod: item.bidMethdNm || "",
    postedAt: item.bidNtceDate || null,
    closeAt: item.bidClseDate || null,
    baseAmount: item.presmptPrce || null,
    detailUrl: item.bidNtceDtlUrl || null,
    source: "naraTerm-api",
    isToday: false, // 게시 화면에서 신규 표시용 플래그, 갱신 로직에서 세팅
    updatedAt: new Date().toISOString(),
  };
}

async function fetchOperation(op) {
  const url = `${BASE_URL}/${op.path}?serviceKey=${NARA_API_KEY}&pageNo=1&numOfRows=100&type=json&inqryDiv=1&inqryBgnDt=${todayStr()}0000&inqryEndDt=${todayStr()}2359`;

  const res = await fetch(url);
  if (!res.ok) {
    logger.error(`나라장터 API 호출 실패 (${op.type})`, res.status);
    return [];
  }
  const data = await res.json();
  const items = data?.response?.body?.items || [];
  return items.map((item) => toNoticeDoc(item, op.type)).filter(isBusanRelated);
}

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// ── 메인 스케줄 함수: 10분 간격 실행 ──────────────────────
exports.collectNaraNotices = onSchedule(
  {
    schedule: "every 10 minutes",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",
  },
  async () => {
    if (!NARA_API_KEY) {
      logger.error("NARA_API_KEY 환경변수가 설정되지 않았습니다.");
      return;
    }

    const results = await Promise.all(OPERATIONS.map(fetchOperation));
    const notices = results.flat();

    if (notices.length === 0) {
      logger.info("신규/해당 공고 없음");
      return;
    }

    const batch = db.batch();
    for (const notice of notices) {
      if (!notice.bidNtceNo) continue;
      const ref = db.collection("notices").doc(notice.bidNtceNo);
      batch.set(ref, notice, { merge: true });
    }
    await batch.commit();

    logger.info(`${notices.length}건 처리 완료`);
  }
);
