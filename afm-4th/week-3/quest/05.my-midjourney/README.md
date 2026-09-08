# CHILL RENDER — My Midjourney (Week 3 · 퀘스트 5)

자동차 주변기기 제품 이미지 생성기. **3D 렌더 · 도시적이고 차가운 톤** 프리셋 내장.
Node 내장 모듈만 사용 (의존성 0).

## 실행

```bash
cp .env.example .env      # FAL_KEY 채우기
node server.js            # http://localhost:3001
```

- `/` — 생성기 앱
- `/showcase.html` — 소개 사이트 (화풍 4종 예시)

## 화풍 프리셋

| 프리셋 | 톤 | 예시 |
|---|---|---|
| 스튜디오 블랙 | 무광 검정 · 림라이트 · 반사 바닥 | `showcase/style-1-studio-black.jpg` |
| 콘크리트 브루탈 | 노출 콘크리트 · 하드 섀도우 · 회색 | `showcase/style-2-concrete.jpg` |
| 크롬 & 아이스 | 폴리시드 크롬 · 시안 조명 · 냉각 유리 | `showcase/style-3-chrome-ice.jpg` |
| 블루프린트 렌더 | 다크 네이비 · 와이어프레임 · 설계 도면 | `showcase/style-4-blueprint.jpg` |
| 커스텀 | 직접 지시문 작성 | — |

제품 설명만 입력하면 스타일 지시문이 자동으로 뒤에 붙는다.

## 두 가지 모드

**생성** — 텍스트만으로 새 이미지 (`fal-ai/flux/dev`, 28 steps)

**리스타일** — 실물 사진을 올리면 형태를 유지한 채 화풍만 교체 (`flux image-to-image`).
화풍 적용 강도 슬라이더로 조절한다.

| 강도 | 결과 |
|---|---|
| 0.20~0.50 | 원본 유지. 배경이 안 바뀜 |
| **0.65~0.75** | 배경·조명·재질 교체, 형태 유지 — **권장** |
| 0.80 이상 | 얇은 부품·케이블이 뭉개짐 |

## 한글 프롬프트 자동 번역

flux는 한글을 이해하지 못한다. 한글이 섞이면 `gpt-4o-mini`로 영문 프롬프트로 옮긴 뒤 생성한다.
번역 결과는 캐시되며 서버 로그에 남는다.

## 제공자 전환

`.env`의 `IMAGE_PROVIDER` — `fal`(기본) 또는 `openai`(`gpt-image-1`). 둘 다 생성·리스타일을 지원한다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 제공자·모델·키 확인 |
| GET | `/api/styles` | 프리셋 목록 |
| GET | `/api/gallery` | 생성 기록 |
| POST | `/api/generate` | `{ subject, style, size, n, quality, image?, strength? }` |
| POST | `/api/delete` | `{ file }` — 갤러리·디스크에서 삭제 |
| POST | `/api/clear` | 전체 삭제 |

> API 키는 서버에만 두고 브라우저로 내려보내지 않는다. `.env`는 `.gitignore` 처리됨.
