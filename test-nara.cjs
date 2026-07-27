// 나라장터 API 호출 테스트 (Firebase 연동 없이 호출만 확인)
// 사용법: node test-nara.cjs 인증키

const https = require("https");

const apiKey = process.argv[2];
if (!apiKey) {
  console.error("사용법: node test-nara.cjs <인증키>");
  process.exit(1);
}

function todayStr() {
  const d = new Date();
  return (
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0")
  );
}

const url = `https://apis.data.go.kr/1230000/BidPublicInfoService/getBidPblancListInfoServc?serviceKey=${apiKey}&pageNo=1&numOfRows=5&type=json&inqryDiv=1&inqryBgnDt=${todayStr()}0000&inqryEndDt=${todayStr()}2359`;

https
  .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      console.log("상태 코드:", res.statusCode);
      console.log("응답 내용:", data.slice(0, 500));
    });
  })
  .on("error", (err) => console.error("요청 에러:", err));