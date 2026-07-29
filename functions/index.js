/**
 * 부산지역 공기업/공공기관 사업공고 자동 수집 Cloud Function
 *
 * - 나라장터 오픈API(나라장터검색조건에 의한 입찰공고조회, PPSSrch)를 주기적으로 호출
 * - 발주기관명(공고기관/수요기관)에 "부산"이 포함된 공고만 필터링
 *   (참여 가능 지역이 아니라, 발주처 자체가 부산 소재 공기업/공공기관인지 기준)
 * - Firestore 'notices' 컬렉션에 upsert (공고번호 기준 중복 방지)
 *
 * 환경변수(.env 또는 functions:config)로 다음 값을 설정해야 합니다.
 *   NARA_API_KEY : data.go.kr에서 발급받은 인증키(서비스키, Decoding 키 사용 권장)
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

// ── 설정 ──────────────────────────────────────────────
// ⚠️ 공식 참고문서 기준 정확한 경로: /1230000/ad/BidPublicInfoService (ad 누락 주의)
const BASE_URL = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";

// 업무구분별 오퍼레이션 (나라장터검색조건에 의한 입찰공고조회) — 지금은 용역만 수집
const OPERATIONS = [
  { type: "용역", path: "getBidPblancListInfoServcPPSSrch" },
];

// 발주기관명에 이 키워드 중 하나라도 포함되면 "부산 소재 공기업/공공기관"으로 판별
// - "부산"은 기본 키워드
// - 나머지는 부산혁신도시 등으로 이전해서 이름에 "부산"이 안 들어가는 주요 기관들
const BUSAN_KEYWORDS = [
  "부산",
  // 부산혁신도시 등으로 이전해서 이름에 "부산"이 안 들어가는 공공기관
  "한국남부발전",
  "한국자산관리공사",
  "한국주택금융공사",
  "한국예탁결제원",
  "주택도시보증공사",
  "국립수산물품질관리원",
  "국립해양조사원",
  "한국해양수산개발원",
  "한국해양과학기술원",
  "영화진흥위원회",
  "영상물등급위원회",
  "게임물관리위원회",
  "한국청소년상담복지개발원",
  "한국선급",
  // 부산시 산하 출자·출연기관 중 이름에 "부산"이 없는 곳
  "벡스코",
  "아시아드컨트리클럽",
  "아시아드CC",
  "영화의전당",
  // 부산 소재 금융공기업 등 (부산국제금융센터 BIFC 입주기관 포함)
  "한국거래소",
  "기술보증기금",
  "한국해양진흥공사",
  // 부산 소재 국립대학
  "부경대학교",
  "한국해양대학교",
];

// ── 유틸 ──────────────────────────────────────────────
function isBusanAgency(item) {
  const org = (item.ntceInsttNm || "") + "" + (item.dminsttNm || "");
  return BUSAN_KEYWORDS.some((kw) => org.includes(kw));
}

function toNoticeDoc(item, type) {
  return {
    bidNtceNo: item.bidNtceNo || null,
    type,
    title: item.bidNtceNm || "",
    org: item.ntceInsttNm || item.dminsttNm || "",
    region: item.prtcptPsblRgnNm || "",
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

// ⚠️ 임시 백필(과거 놓친 공고 소급 수집)용 — 1회 실행 후 반드시 todayStr()로 되돌릴 것
const BACKFILL_START = "20260628"; // 최근 30일 정도로 넉넉히 잡음, 필요시 조정

async function fetchOperation(op, apiKey) {
  const url = `${BASE_URL}/${op.path}?ServiceKey=${apiKey}&pageNo=1&numOfRows=300&type=json&inqryDiv=1&inqryBgnDt=${BACKFILL_START}0000&inqryEndDt=${todayStr()}2359`;

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
  return items.filter(isBusanAgency).map((item) => toNoticeDoc(item, op.type));
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

// ── 새 공고가 Firestore에 새로 생성될 때마다 구독자들에게 푸시 알림 발송 ──
exports.notifyNewNotice = onDocumentCreated(
  { document: "notices/{noticeId}", region: "asia-northeast3" },
  async (event) => {
    const notice = event.data?.data();
    if (!notice) return;

    const subsSnap = await db.collection("subscribers").get();
    if (subsSnap.empty) {
      logger.info("등록된 알림 구독자가 없음");
      return;
    }
    const tokens = subsSnap.docs.map((d) => d.id);

    const message = {
      notification: {
        title: "부산 신규 공고 등록",
        body: notice.title || "새 공고가 등록되었습니다.",
      },
      webpush: {
        fcmOptions: {
          link: notice.detailUrl || "https://busan-agency-bid.pages.dev",
        },
      },
      tokens,
    };

    const res = await getMessaging().sendEachForMulticast(message);
    logger.info(`알림 발송: 성공 ${res.successCount} / 실패 ${res.failureCount}`);

    const invalidTokens = [];
    res.responses.forEach((r, i) => {
      if (!r.success) invalidTokens.push(tokens[i]);
    });
    await Promise.all(
      invalidTokens.map((t) => db.collection("subscribers").doc(t).delete())
    );
  }
);