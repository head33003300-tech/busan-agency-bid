/**
 * 부산지역 공기업/공공기관 사업공고 자동 수집 Cloud Function
 *
 * - 나라장터 오픈API(나라장터검색조건에 의한 입찰공고조회, PPSSrch)를 주기적으로 호출
 * - API 자체의 참가제한지역코드(prtcptLmtRgnCd=26, 부산광역시) 필터로 부산 제한 공고만 조회
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
// ⚠️ 공식 참고문서 기준 정확한 경로: /1230000/ad/BidPublicInfoService (ad 누락 주의)
const BASE_URL = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";

// 부산광역시 참가제한지역코드 = 26 (공식 참고문서 코드표 기준)
const BUSAN_REGION_CODE = "26";

// 업무구분별 오퍼레이션 (나라장터검색조건에 의한 입찰공고조회 - 지역코드 필터 지원)
const OPERATIONS = [
  { type: "물품", path: "getBidPblancListInfoThngPPSSrch" },
  { type: "공사", path: "getBidPblancListInfoCnstwkPPSSrch" },
  { type: "용역", path: "getBidPblancListInfoServcPPSSrch" },
];

// ── 유틸 ──────────────────────────────────────────────
function toNoticeDoc(item, type) {
  return {
    bidNtceNo: item.bidNtceNo || null,
    type,
    title: item.bidNtceNm || "",
    org: item.ntceInsttNm || item.dminsttNm || "",
    region: item.prtcptPsblRgnNm || "",
    regionScope: "부산제한", // prtcptLmtRgnCd=26으로 이미 부산 제한 공고만 조회했으므로 고정
    bidMethod: item.bidMethdNm || "",
    postedAt: item.bidNtceDt || null,
    // 입찰마감일시(bidClseDt)가 없는 공고(주로 협상에 의한 계약)는
    // 개찰일시(opengDt)를 대신 마감 판단 기준으로 사용
    closeAt: item.bidClseDt || item.opengDt || null,
    baseAmount: item.presmptPrce || null,
    detailUrl: item.bidNtceDtlUrl || null,
    source: "naraTerm-api",
    updatedAt: new Date().toISOString(),
  };
}

const https = require("https");

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            Accept: "application/json",
            "Accept-Encoding": "identity",
            Connection: "close",
          },
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve({ status: res.statusCode, body: data }));
        }
      )
      .on("error", reject);
  });
}

async function fetchOperation(op, apiKey) {
  const url = `${BASE_URL}/${op.path}?ServiceKey=${apiKey}&pageNo=1&numOfRows=100&type=json&inqryDiv=1&inqryBgnDt=${todayStr()}0000&inqryEndDt=${todayStr()}2359&prtcptLmtRgnCd=${BUSAN_REGION_CODE}`;

  const { status, body } = await httpsGetJson(url);
  if (status !== 200) {
    logger.error(`나라장터 API 호출 실패 (${op.type}) ${status}`, body.slice(0, 500));
    return [];
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    logger.error(`나라장터 API 응답 파싱 실패 (${op.type})`, body.slice(0, 500));
    return [];
  }
  const items = data?.response?.body?.items || [];
  return items.map((item) => toNoticeDoc(item, op.type));
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

    // 조회할 때마다(신규 공고 유무와 무관하게) 마지막 조회 시각 기록
    await db.collection("meta").doc("status").set(
      {
        lastCheckedAt: new Date().toISOString(),
        lastFoundCount: notices.length,
      },
      { merge: true }
    );

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
        extra = { firstSeenAt: today, firstSeenTime: new Date().toISOString(), isExtended: false };
      } else {
        const closeChanged =
          existing.closeAt && notice.closeAt && existing.closeAt !== notice.closeAt;
        extra = {
          firstSeenAt: existing.firstSeenAt || today,
          firstSeenTime: existing.firstSeenTime || new Date().toISOString(),
          isExtended: !!existing.isExtended || !!closeChanged,
        };
      }

      batch.set(ref, { ...notice, ...extra }, { merge: true });
    }
    await batch.commit();

    logger.info(`${notices.length}건 처리 완료`);
  }
);