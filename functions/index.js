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

async function fetchOperation(op, apiKey) {
  const url = `${BASE_URL}/${op.path}?serviceKey=${apiKey}&pageNo=1&numOfRows=100&type=json&inqryDiv=1&inqryBgnDt=${todayStr()}0000&inqryEndDt=${todayStr()}2359`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    logger.error(`나라장터 API 호출 실패 (${op.type}) ${res.status}`, bodyText.slice(0, 500));
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 메인 스케줄 함수: 10분 간격 실행 ──────────────────────
exports.collectNaraNotices = onSchedule(
  {
    schedule: "every 10 minutes",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",
    secrets: ["NARA_API_KEY"],
  },
  async () => {
    const apiKey = process.env.NARA_API_KEY;
    if (!apiKey) {
      logger.error("NARA_API_KEY 환경변수가 설정되지 않았습니다.");
      return;
    }

    const notices = [];
    for (const op of OPERATIONS) {
      const result = await fetchOperation(op, apiKey);
      notices.push(...result);
      await sleep(400);
    }

    if (notices.length === 0) {
      logger.info("신규/해당 공고 없음");
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

    logger.info(`${notices.length}건 처리 완료`);
  }
);