# PROTO — My ChatGPT (Week 3 · 퀘스트 4)

자동차 주변기기 **제품개발 AI** 페르소나 챗봇. Node 내장 모듈만 사용 (의존성 0).

## 실행

```bash
cp .env.example .env      # OPENAI_API_KEY 채우기
node server.js            # http://localhost:3000
```

## 구성

| 파일 | 역할 |
|---|---|
| `server.js` | 정적 서빙 + OpenAI 프록시 + 세션별 대화 기록(인메모리) |
| `index.html` | 프로필 설정 패널 + 채팅 UI |
| `.env` | API 키 (git 제외) |

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 키 로드 여부·모델 확인 |
| POST | `/api/chat` | `{ message, sessionId, profile }` → `{ reply, turns }` |
| POST | `/api/reset?sessionId=` | 대화 기록 초기화 |

## 프로필

이름·성격·말투·전문분야·추가지침을 UI에서 바꾸면 시스템 프롬프트가 재구성된다.
프리셋 3종: 프로토(제품개발) / 박선배(깐깐한 사수) / 미스터 바이어(유통).

> API 키는 서버에만 두고 브라우저로 내려보내지 않는다. `.env`는 `.gitignore` 처리됨.
