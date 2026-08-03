/**
 * 부산지역 공기업/공공기관 사업공고 자동 수집 Cloud Function
 *
 * - 나라장터 오픈API(나라장터검색조건에 의한 입찰공고조회, PPSSrch)를 주기적으로 호출
 * - 발주기관명(공고기관/수요기관)에 "부산"이 포함된 공고만 필터링
 * - 한국남부발전 자체 API도 함께 수집
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
  "강원",
  "경기",
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

  const isNationwideAgency = NATIONWIDE_AGENCIES.some((agency) => targetOrg.includes(agency));
  if (isNationwideAgency) {
    const contextText = `${targetOrg} ${title} ${region}`;
    const hasBusanContext = BUSAN_CONTEXT_KEYWORDS.some((kw) => contextText.includes(kw));
    const hasNonBusanLocation = NON_BUSAN_LOCATION_KEYWORDS.some((kw) => contextText.includes(kw));

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

async function fetchOperation(op, apiKey) {
  const numOfRows = 300;
  let pageNo = 1;
  let totalCount = Infinity;
  const collected = [];

  while ((pageNo - 1) * numOfRows < totalCount) {
    const url = `${BASE_URL}/${op.path}?ServiceKey=${apiKey}&pageNo=${pageNo}&numOfRows=${numOfRows}&type=json&inqryDiv=1&inqryBgnDt=${todayStr()}0000&inqryEndDt=${todayStr()}2359`;

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
const NAMBU_BASE_URL = "https://apis.data.go.kr/B552520/BidsInfo/getDataService";

const NAMBU_NON_BUSAN_KEYWORDS = ["하동", "삼척", "안동", "영월", "제주"];

function toNambuNoticeDoc(item) {
  const postedAt = item.annday3 || item.annday2 || item.annday1 || null;
  const closeAt = item.subedt3 || item.appledt3 || item.deadl2 || null;
  const baseAmount = item.estprc3 || item.estprc2 || item.estprc || null;
  const bidNtceNo = item.announceno || null;

  // 나라장터엔 개별 상세링크가 없어서, 자체 조달시스템 접속 안내 + 공고번호 검색 방법을
  // 비고란에 자동으로 남겨줌
  const remarks = bidNtceNo
    ? `이 공고는 발주기관 자체 조달시스템에 등록되어, 나라장터에서 별도 상세 링크를 지원하지 않습니다. 상세 열람을 희망하시는 경우 링크 접속 -> 통합검색창에 '${bidNtceNo}'로 검색 -> 빈 화면 -> 검색조건을 '공고번호'로 변경 후 재검색하여 확인 부탁드립니다.`
    : null;

  return {
    bidNtceNo,
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
    detailUrl: "https://srm.kepco.net/index.do",
    remarks,
    source: "nambu-api",
    updatedAt: new Date().toISOString(),
  };
}

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
  const url = `${NAMBU_BASE_URL}?ServiceKey=${apiKey}&pageNo=1&numOfRows=100&strSdate=${todayStr()}&strEdate=${todayStr()}`;

  const { status, body } = await httpsGetJson(url);
  if (status !== 200) {
    logger.error(`한국남부발전 API 호출 실패 ${status}`, body.slice(0, 500));
    return [];
  }

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
    if (!title.includes("용역")) continue;
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

    // 한국남부발전 자체 API도 같이 수집 (7월 데이터 지연 문제 해소 확인되어 재활성화)
    try {
      const nambuResults = await fetchNambuPower(apiKey);
      notices.push(...nambuResults);
    } catch (e) {
      logger.error("한국남부발전 API 수집 중 오류", e.message || e);
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
          // 외부(나라장터 등) 링크가 아니라 저희 사이트로 이동시키고, 쿼리 파라미터로
          // 어떤 공고인지 넘겨서 app.js가 자동으로 그 공고의 상세 모달을 열게 함
          link: `https://busan-agency-bid.pages.dev/?notice=${encodeURIComponent(notice.bidNtceNo || "")}`,
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