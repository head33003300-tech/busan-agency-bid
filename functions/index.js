/**
 * 부산지역 공기업/공공기관 사업공고 자동 수집 Cloud Function
 *
 * - 나라장터 오픈API(나라장터검색조건에 의한 입찰공고조회, PPSSrch)를 주기적으로 호출
 * - 발주기관명(공고기관/수요기관)에 "부산"이 포함된 공고만 필터링
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
const BASE_URL = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";

const OPERATIONS = [
  { type: "용역", path: "getBidPblancListInfoServcPPSSrch" },
];

const BUSAN_KEYWORDS = [
  "부산",
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
  "벡스코",
  "아시아드컨트리클럽",
  "아시아드CC",
  "영화의전당",
  "한국거래소",
  "기술보증기금",
  "한국해양진흥공사",
  "부경대학교",
  "한국해양대학교",
  "경성대학교",
  "고신대학교",
  "동명대학교",
  "동서대학교",
  "동아대학교",
  "동의대학교",
  "신라대학교",
  "경남정보대학교",
  "대동대학교",
  "동의과학대학교",
  "화신사이버대학교",
];

// 전국에 지사/사업소가 있어서 "기관명만 보면" 다른 지역 공고까지 다 걸리는 기관들.
// 이 기관들은 추가로 "타지역 명칭이 있는데 부산 언급이 없으면" 제외 처리함
const NATIONWIDE_AGENCIES = [
  "한국남부발전",
  "한국자산관리공사",
  "한국주택금융공사",
  "한국예탁결제원",
  "주택도시보증공사",
  "한국거래소",
  "기술보증기금",
];

const BUSAN_CONTEXT_KEYWORDS = [
  "부산",
  "부산본사",
  "부산사옥",
  "부산지사",
  "부산사업소",
  "부산광역시",
];

const NON_BUSAN_LOCATION_KEYWORDS = [
  "서울",
  "서울사옥",
  "서울사무소",
  "수도권",
  "인천",
  "경기",
  "강원",
  "대전",
  "세종",
  "대구",
  "광주",
  "울산",
  "제주",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "하동",
  "삼척",
  "안동",
  "영월",
];

// ── 유틸 ──────────────────────────────────────────────
// 나라장터 공고는 두 가지 패턴이 있음:
// 1) 조달청이 대리로 올리는 경우: 공고기관명이 "OO지방조달청"이라 지역명이 실제
//    발주처 소재지와 무관함 → 이땐 공고기관명은 무시하고 수요기관명(실제 발주처)만 확인
// 2) 기관이 직접 올리는 경우(예: 한국남부발전주식회사): 공고기관명 자체가 진짜 발주처
function isBusanAgency(item) {
  const ntce = item.ntceInsttNm || "";
  const dm = item.dminsttNm || "";
  const title = item.bidNtceNm || "";
  const region = item.prtcptPsblRgnNm || "";

  const targetOrg = ntce.includes("조달청") ? dm : `${ntce} ${dm}`;

  const matchedKeyword = BUSAN_KEYWORDS.find((keyword) => targetOrg.includes(keyword));
  if (!matchedKeyword) return false;

  // 전국 단위 기관(지사/사업소가 여러 지역에 있는 곳)이면 지역 문맥까지 확인
  const isNationwideAgency = NATIONWIDE_AGENCIES.some((agency) => targetOrg.includes(agency));
  if (isNationwideAgency) {
    const contextText = `${targetOrg} ${title} ${region}`;
    const hasBusanContext = BUSAN_CONTEXT_KEYWORDS.some((kw) => contextText.includes(kw));
    const hasNonBusanLocation = NON_BUSAN_LOCATION_KEYWORDS.some((kw) => contextText.includes(kw));

    // 다른 지역은 명시되어 있는데 부산은 명시되지 않은 경우 제외
    if (hasNonBusanLocation && !hasBusanContext) {
      logger.info(`타지역 공고 제외: ${title} / 기관: ${targetOrg}`);
      return false;
    }
  }

  return true;
}

function toNoticeDoc(item, type) {
  const ntce = item.ntceInsttNm || "";
  const dm = item.dminsttNm || "";
  const displayOrg = ntce.includes("조달청") ? dm || ntce : ntce || dm;

  return {
    bidNtceNo: item.bidNtceNo || null,
    type,
    title: item.bidNtceNm || "",
    org: displayOrg,
    // 디버깅용: 어떤 필드 때문에 걸렸는지 확인할 수 있게 원본 기관명 둘 다 저장
    ntceInsttNm: ntce,
    dminsttNm: dm,
    region: item.prtcptPsblRgnNm || "",
    bidMethod: item.bidMethdNm || "",
    postedAt: item.bidNtceDt || null,
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

// ⚠️ 임시 백필용 — 다 끝나면 아래 두 줄을 지우고, fetchOperation 안의
// ${BACKFILL_START}/${BACKFILL_END}를 ${todayStr()}로 되돌릴 것
const BACKFILL_START = "20260629";
const BACKFILL_END = "20260729";

async function fetchOperation(op, apiKey) {
  const numOfRows = 300;
  let pageNo = 1;
  let totalCount = Infinity;
  const collected = [];

  while ((pageNo - 1) * numOfRows < totalCount) {
    const url = `${BASE_URL}/${op.path}?ServiceKey=${apiKey}&pageNo=${pageNo}&numOfRows=${numOfRows}&type=json&inqryDiv=1&inqryBgnDt=${BACKFILL_START}0000&inqryEndDt=${BACKFILL_END}2359`;

    const { status, body } = await httpsGetJson(url);
    if (status !== 200) {
      logger.error(`나라장터 API 호출 실패 (${op.type}, page ${pageNo}) ${status}`, body.slice(0, 500));
      break;
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch (e) {
      logger.error(`나라장터 API 응답 파싱 실패 (${op.type}, page ${pageNo})`, body.slice(0, 500));
      break;
    }
    const resultCode = data?.response?.header?.resultCode;
    if (resultCode && resultCode !== "00") {
      logger.error(
        `나라장터 API 응답 오류 (${op.type}, page ${pageNo}) resultCode=${resultCode}`,
        data?.response?.header?.resultMsg || ""
      );
      break;
    }
    const items = data?.response?.body?.items || [];
    totalCount = Number(data?.response?.body?.totalCount) || items.length;

    for (const item of items) {
      if (isBusanAgency(item)) collected.push(toNoticeDoc(item, op.type));
    }

    if (items.length === 0) break;
    pageNo += 1;
    await sleep(300);
  }

  return collected;
}

// ── 한국남부발전 자체 API 연동 ──────────────────────────
// 나라장터에 안 잡히는 "연계기관"(자체 전자조달) 공고를 보완하기 위한 별도 소스.
// data.go.kr의 "한국남부발전(주)_입찰정보"(B552520/BidsInfo) API 사용.
// ⚠️ 이 API의 category 필드는 "용역/공사"를 정확히 구분 안 해서(자가측정 "용역"도
//    "공사영역"으로 분류됨), category 대신 제목에 "용역"이 포함되는지로 판단함.
const NAMBU_BASE_URL = "https://apis.data.go.kr/B552520/BidsInfo/getDataService";

// 한국남부발전 소속 비-부산 발전소(하동빛드림본부, 삼척빛드림본부 등)에서 올린 공고는 제외
const NAMBU_NON_BUSAN_KEYWORDS = ["하동", "삼척", "안동", "영월", "제주"];

function toNambuNoticeDoc(item) {
  const postedAt = item.annday3 || item.annday2 || item.annday1 || null;
  const closeAt = item.subedt3 || item.appledt3 || item.deadl2 || null;
  const baseAmount = item.estprc3 || item.estprc2 || item.estprc || null;

  return {
    bidNtceNo: item.announceno || null,
    type: "용역",
    title: item.title || "",
    org: "한국남부발전주식회사",
    ntceInsttNm: "한국남부발전주식회사",
    dminsttNm: item.dprtnm || "",
    region: "",
    bidMethod: "",
    postedAt: formatNambuDate(postedAt),
    closeAt: formatNambuDate(closeAt),
    baseAmount,
    detailUrl: null,
    source: "nambu-api",
    updatedAt: new Date().toISOString(),
  };
}

// 남부발전 API 날짜 형식(YYYYMMDDHHmmss 또는 YYYYMMDD)을 저희 표준 형식(YYYY-MM-DD HH:mm:ss)으로 변환
function formatNambuDate(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const y = digits.slice(0, 4);
  const m = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  const hh = digits.slice(8, 10) || "00";
  const mm = digits.slice(10, 12) || "00";
  const ss = digits.slice(12, 14) || "00";
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

async function fetchNambuPower(apiKey) {
  const url = `${NAMBU_BASE_URL}?ServiceKey=${apiKey}&pageNo=1&numOfRows=100&strSdate=${BACKFILL_START}&strEdate=${BACKFILL_END}`;

  const { status, body } = await httpsGetJson(url);
  if (status !== 200) {
    logger.error(`한국남부발전 API 호출 실패 ${status}`, body.slice(0, 500));
    return [];
  }

  // 이 API는 XML로 응답함(요청에 type=json 파라미터가 없음)
  const items = [];
  const itemBlocks = body.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const item = {};
    const fieldRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = fieldRegex.exec(block)) !== null) {
      item[m[1]] = m[2].trim();
    }
    items.push(item);
  }

  const results = [];
  for (const item of items) {
    const title = item.title || "";
    const dprtnm = item.dprtnm || "";
    if (!title.includes("용역")) continue; // 용역만 사용
    const context = `${dprtnm} ${title}`;
    const isBusan =
      context.includes("부산") ||
      !NAMBU_NON_BUSAN_KEYWORDS.some((kw) => context.includes(kw));
    if (!isBusan) continue;
    results.push(toNambuNoticeDoc(item));
  }
  return results;
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
    timeoutSeconds: 300,
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

    // 구독자마다 설정한 키워드가 있으면(공고명/기관명에 하나라도 포함될 때만),
    // 없으면(빈 배열/미설정) 전체 공고에 대해 알림 발송
    const noticeText = `${notice.title || ""} ${notice.org || ""}`.toLowerCase();
    const matchedDocs = subsSnap.docs.filter((d) => {
      const keywords = d.data().keywords;
      if (!keywords || keywords.length === 0) return true;
      return keywords.some((kw) => noticeText.includes(String(kw).toLowerCase()));
    });

    if (matchedDocs.length === 0) {
      logger.info("키워드 필터에 맞는 구독자가 없음");
      return;
    }

    // 구독자의 진동 설정(vibrate)에 따라 두 그룹으로 나눠서 각각 발송
    const vibrateOnTokens = matchedDocs
      .filter((d) => d.data().vibrate !== false)
      .map((d) => d.id);
    const vibrateOffTokens = matchedDocs
      .filter((d) => d.data().vibrate === false)
      .map((d) => d.id);

    const buildMessage = (tokens, vibrateFlag) => ({
      notification: {
        title: "부산 신규 공고 등록",
        body: notice.title || "새 공고가 등록되었습니다.",
      },
      data: { vibrate: String(vibrateFlag) },
      webpush: {
        fcmOptions: {
          link: notice.detailUrl || "https://busan-agency-bid.pages.dev",
        },
      },
      tokens,
    });

    const invalidTokens = [];
    for (const [tokens, vibrateFlag] of [
      [vibrateOnTokens, true],
      [vibrateOffTokens, false],
    ]) {
      if (tokens.length === 0) continue;
      const res = await getMessaging().sendEachForMulticast(buildMessage(tokens, vibrateFlag));
      logger.info(
        `알림 발송(진동 ${vibrateFlag}): 성공 ${res.successCount} / 실패 ${res.failureCount}`
      );
      res.responses.forEach((r, i) => {
        if (!r.success) invalidTokens.push(tokens[i]);
      });
    }

    await Promise.all(
      invalidTokens.map((t) => db.collection("subscribers").doc(t).delete())
    );
  }
);