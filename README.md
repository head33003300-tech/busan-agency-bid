# 부산지역 공기업/공공기관 사업공고 모니터링 사이트

나라장터 오픈API로 부산지역 공기업/공공기관 사업공고를 자동 수집하고,
관리자가 수동으로도 공고를 추가할 수 있는 모니터링 사이트입니다.

## 구조

```
busan-public-notice/
├── functions/          # Cloud Functions (10분 간격 나라장터 API 자동 수집)
│   ├── index.js
│   └── package.json
├── public/              # 공개 조회 페이지 (조회 전용)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── firebase-config.js   # ⚠️ 본인 Firebase 설정값으로 교체 필요
├── admin/               # 관리자 화면 (로그인 + 수동 추가/삭제)
│   ├── index.html
│   └── admin.js
└── firestore.rules      # 보안 규칙 (조회: 전체공개 / 쓰기: 로그인 사용자만)
```

## 설정 순서

### 1. 나라장터 API 인증키 발급
1. https://www.data.go.kr 가입 및 로그인
2. "나라장터 입찰공고정보서비스" 검색 → 활용신청 (자동승인)
3. 마이페이지 > 인증키 확인 (Decoding 키 사용 권장)

### 2. Firebase 프로젝트 생성
1. https://console.firebase.google.com 에서 신규 프로젝트 생성
2. Firestore Database 생성 (리전: asia-northeast3, 서울)
3. Authentication > 이메일/비밀번호 로그인 방식 활성화 → 관리자 계정 1개 생성
4. Cloud Functions 사용을 위해 Blaze(종량제) 요금제로 업그레이드
   (예약 함수는 무료 한도 내에서 대부분 비용이 발생하지 않지만, 결제수단 등록이 필수입니다)
5. 프로젝트 설정 > 일반 > 웹 앱 추가 → 설정값을 `public/firebase-config.js`에 붙여넣기

### 3. Cloud Functions 배포
```bash
cd functions
npm install
firebase functions:secrets:set NARA_API_KEY   # 발급받은 인증키 입력
firebase deploy --only functions,firestore:rules
```

### 4. 공개 페이지 / 관리자 페이지 배포
기존 부산 지원사업 공고 사이트와 동일하게 GitHub 저장소 + Cloudflare Pages로 배포합니다.
- `public/` → 공개 URL
- `admin/` → 별도 경로 또는 서브도메인 (예: /admin)

## 참고
- 부산 판별 로직은 발주기관 소재지가 아니라, 입찰 "참가가능지역(참여 기업 소재지 제한)"이
  부산을 포함하는지를 기준으로 합니다 (`functions/index.js`의 `isBusanRelated` 함수).
- `BUSAN_KEYWORDS` 배열을 수정해서 판별 키워드를 조정할 수 있습니다.
- 현재는 물품/공사/용역 세 개 업무구분만 수집합니다. 외자 등 추가 구분이 필요하면
  `functions/index.js`의 `OPERATIONS` 배열에 오퍼레이션을 추가하세요.
"# busan-agency-bid" 
"# busan-agency-bid" 
"# busan-agency-bid" 
