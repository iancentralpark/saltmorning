# Google Cloud 설정 (처음부터)

브라우저에 탭 2개가 열렸습니다. **같은 Google 계정**(Classroom 쓰는 선생님 계정)으로 로그인하세요.

---

## A. 서비스 계정 (Sheets 읽기/쓰기) — 5분

1. **Service Accounts** 탭  
   → **+ CREATE SERVICE ACCOUNT**  
   - Name: `mrpark-sheets`  
   - Create and Continue → Role: **Editor** (또는 건너뛰기) → Done

2. 만든 계정 클릭 → **Keys** 탭 → **Add key** → **Create new key** → **JSON** → Download

3. 다운로드한 파일을 아래 경로로 저장 (이름 변경):
   ```
   server/service-account.json
   ```

4. JSON 안 `"client_email"` 값 복사 (예: `mrpark-sheets@....iam.gserviceaccount.com`)

5. [Mr.Park 스프레드시트](https://docs.google.com/spreadsheets/d/1XNZYW16PWijfNZPe3knwLnTw5Be_x_BoCeL3G1WO7jg/edit) 열기  
   → **공유** → 그 이메일 붙여넣기 → **편집자** → 완료

6. **API 활성화** (한 번만):
   - [Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) → Enable
   - [Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) → Enable (공휴일)

---

## B. Classroom (Apps Script — 권장)

**Node OAuth는 더 이상 필요 없습니다.** Classroom 게시/연결은 Apps Script가 선생님 계정으로 처리합니다 (7일 만료 없음).

1. Apps Script 편집기 → **서비스** (+) → **Google Classroom API** 추가 (이미 `appsscript.json`에 있으면 생략)
2. `clasp push` 후 웹앱 재배포

숙제 Post 시: Node API가 시트에 저장 → GAS가 Classroom에 게시.

### (선택) Node OAuth — 레거시

Railway에서 Classroom을 Node로만 쓰려면 `CLASSROOM_ON_NODE=true` + 아래 설정. **Testing 모드면 refresh token이 7일마다 만료**되므로 비권장.

1. **OAuth consent screen** → **Publish app** → **Production** (Testing이면 7일 만료)
2. **Credentials** → OAuth client (Desktop app)
3. `npm run oauth-setup` → Railway에 `GOOGLE_OAUTH_*` 저장

---

## C. 로컬 확인

```bash
cd server
npm run check-setup   # 전부 ✓ 나와야 함
npm run dev
```

다른 터미널:
```bash
curl http://localhost:8787/api/health
```
→ `"classroomOAuth": true` 확인

웹앱 콘솔:
```javascript
localStorage.setItem('mrpark_node_api', 'http://localhost:8787');
location.reload();
```

---

## D. Railway (로컬 OK 후)

1. [railway.app/new](https://railway.app/new) → GitHub 연결 또는 CLI:
   ```bash
   npx @railway/cli login
   cd server
   npx @railway/cli init
   npx @railway/cli up
   ```

2. Railway **Variables** (`.env`와 동일 + JSON 한 줄):
   | Variable | 값 |
   |----------|-----|
   | `SPREADSHEET_ID` | `1XNZYW16PWijfNZPe3knwLnTw5Be_x_BoCeL3G1WO7jg` |
   | `TIMEZONE` | `Asia/Seoul` |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | `npm run railway-env` 출력 전체 |
   | `GOOGLE_OAUTH_*` | (선택) `CLASSROOM_ON_NODE=true` 일 때만 |

3. Public URL → Apps Script **스크립트 속성** `NODE_API_URL` = 그 URL

---

A·B 끝나면 채팅에 **「설정 완료」** 라고 보내주세요. `check-setup` 돌리고 Railway까지 이어서 진행하겠습니다.
