# Mr.Park Class — Node API

Google Sheets + Google Classroom을 백엔드로 쓰는 **빠른 API**입니다.  
Node URL이 설정되면 거의 모든 기능이 Node로 처리됩니다.

## Setup (로컬)

### 1. Google Cloud

**서비스 계정 (Sheets)**

1. [Google Cloud Console](https://console.cloud.google.com/) → 프로젝트
2. **Google Sheets API** (+ **Google Calendar API** — 공휴일)
3. 서비스 계정 JSON → `server/service-account.json`
4. [스프레드시트](https://docs.google.com/spreadsheets/d/1XNZYW16PWijfNZPe3knwLnTw5Be_x_BoCeL3G1WO7jg/edit)에 서비스 계정 **편집자** 초대

**Classroom (Apps Script — default)**

Classroom post/link uses **Apps Script** (teacher account, no 7-day token expiry).  
Node saves homework to Sheets; the web app calls GAS to publish to Classroom.

**OAuth (optional legacy)** — only if `CLASSROOM_ON_NODE=true` on Railway:

```bash
cd server
node scripts/oauth-setup.js
```

Publish OAuth consent screen to **Production** if you use this path (Testing mode expires refresh tokens in ~7 days).

### 2. 실행

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

헬스체크: `http://localhost:8787/api/health`  
→ `"classroomOAuth": true` 이면 Classroom 준비 완료

### 3. 웹앱 연결

**로컬 테스트** — 브라우저 콘솔:

```javascript
localStorage.setItem('mrpark_node_api', 'http://localhost:8787');
location.reload();
```

**배포** — Apps Script 스크립트 속성:

| 이름 | 값 |
|------|-----|
| `NODE_API_URL` | `https://your-app.up.railway.app` |

→ `clasp push` + 웹앱 재배포

---

## Railway 배포

1. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. **Root Directory**: `server`
3. **Variables** (Settings → Variables):

| Variable | 값 |
|----------|-----|
| `SPREADSHEET_ID` | `1XNZYW16PWijfNZPe3knwLnTw5Be_x_BoCeL3G1WO7jg` |
| `TIMEZONE` | `Asia/Seoul` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 서비스 계정 JSON 전체 (한 줄) |
| `GOOGLE_OAUTH_*` | (선택) `CLASSROOM_ON_NODE=true` 일 때만 |
| `CORS_ORIGINS` | (선택) `https://script.google.com` |

4. Deploy 후 **Public URL** 복사 → `NODE_API_URL` 또는 `localStorage.mrpark_node_api`

`railway.toml`에 healthcheck(`/api/health`)가 설정되어 있습니다.

---

## API 요약

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 상태 + `classroomOAuth` |
| GET | `/api/initial` | 클래스 목록 |
| GET | `/api/session`, `/api/work`, `/api/sidebar` | 세션 데이터 |
| POST | `/api/attendance`, `/api/chambit/*`, `/api/dollar` | 출석·Chambit·달러 |
| POST | `/api/textbook/*` | 교재 CRUD |
| GET/POST | `/api/rules`, `/api/announcement`, … | 사이드바 |
| GET | `/api/classroom/courses` | Classroom 코스 목록 |
| POST | `/api/classroom/link` | 클래스 ↔ Classroom 연결 |
| POST | `/api/homework/post` | 숙제 저장 + Classroom 게시 |
| GET | `/api/homework/student` | 학생 숙제 상태 |
| POST | `/api/homework/completion` | 숙제 완료 체크 |

## Note

- **Classroom**: default path is GAS (`classroomViaGas: true` on `/api/health`). No Node OAuth required.
- Set `CLASSROOM_ON_NODE=true` only if you want Node to call Classroom directly (needs OAuth; Testing apps expire in ~7 days).
