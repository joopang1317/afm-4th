"""나노바나나(gemini-2.5-flash-image)로 레시피 썸네일 생성.

사용 예:
  GEMINI_API_KEY=... python gen_thumbnail.py --dish "마늘 버터 새우 파스타" \
      --dish-en "garlic butter shrimp pasta with pink shrimp and garlic" --out thumbnail.png

API 키는 환경변수 GEMINI_API_KEY 로만 받는다. 파일에 저장하지 말 것.
"""
import argparse, base64, json, os, sys, urllib.error, urllib.request

DEFAULT_CHARACTER = (
    "Chihiro, the 10-year-old girl protagonist of Spirited Away with short brown hair "
    "tied in a ponytail, wearing her green-and-white striped shirt"
)
DEFAULT_SCENE = "a warm, lantern-lit bathhouse dining hall at dusk"


def build_prompt(dish_en, character, scene):
    return (
        "A cinematic anime movie still in the style of a Studio Ghibli film. "
        f"{character}, sits at a wooden table in {scene}, "
        f"eagerly eating {dish_en} with chopsticks, cheeks full, eyes sparkling with delight. "
        "Steam rises from the food. Hand-painted watercolor backgrounds, soft golden lighting, "
        "nostalgic and cozy atmosphere. Composition suitable as a recipe thumbnail. "
        "No text, no watermark."
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dish", help="요리명(한글, 로그용)")
    ap.add_argument("--dish-en", required=False, help="요리 영문 묘사 (프롬프트에 사용)")
    ap.add_argument("--character", default=DEFAULT_CHARACTER)
    ap.add_argument("--scene", default=DEFAULT_SCENE)
    ap.add_argument("--prompt", help="전체 프롬프트를 직접 지정 (다른 옵션 무시)")
    ap.add_argument("--model", default="gemini-2.5-flash-image")
    ap.add_argument("--out", default="thumbnail.png")
    a = ap.parse_args()

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("환경변수 GEMINI_API_KEY 가 필요합니다.")
    if not a.prompt and not a.dish_en:
        sys.exit("--dish-en 또는 --prompt 중 하나는 필요합니다.")

    prompt = a.prompt or build_prompt(a.dish_en, a.character, a.scene)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{a.model}:generateContent"
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]}}
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            resp = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:1500]}")

    parts = resp.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    for p in parts:
        if "inlineData" in p:
            out = a.out
            if "png" not in p["inlineData"]["mimeType"] and out.endswith(".png"):
                out = out[:-4] + ".jpg"
            with open(out, "wb") as f:
                f.write(base64.b64decode(p["inlineData"]["data"]))
            print(f"saved {out}" + (f" ({a.dish})" if a.dish else ""))
            return
        if "text" in p:
            print("model text:", p["text"][:300])
    print(json.dumps(resp, ensure_ascii=False)[:1500])
    sys.exit("이미지가 생성되지 않았습니다. 프롬프트를 조정해 재시도하세요.")


if __name__ == "__main__":
    main()
