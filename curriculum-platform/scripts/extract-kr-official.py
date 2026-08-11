#!/usr/bin/env python3
"""Extract complete KR 2022 achievement standards from NCIC 별책 PDFs."""
from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
IMPORTS = ROOT / "imports"


def pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def normalize(text: str) -> str:
    text = text.replace("\u2013", "-").replace("\u2014", "-").replace("\u2212", "-")
    text = text.replace("지 리", "지리")
    text = re.sub(r"[ \t]+", " ", text)
    return text


DOMAIN_TITLES_KO = {
    "01": "듣기·말하기",
    "02": "읽기",
    "03": "쓰기",
    "04": "문법",
    "05": "문학",
    "06": "매체",
}


def parse_standards(text: str, code_re: re.Pattern[str]) -> list[dict]:
    """Pull [code] statement pairs that appear before 성취기준 해설 blocks."""
    text = normalize(text)
    # Prefer the compact achievement-standard listings (before 해설)
    chunks = re.split(r"\(가\)\s*성취기준\s*해설", text)
    pairs: list[tuple[str, str]] = []
    for chunk in chunks:
        # Take the tail of each chunk (listing usually sits just before the split)
        window = chunk[-4000:] if len(chunk) > 4000 else chunk
        for m in code_re.finditer(window):
            code = m.group(1)
            rest = window[m.end() :]
            # Statement continues until next code or section marker
            stop = re.search(
                r"\[[0-9]{1,2}[가-힣(]|\(가\)|\(나\)|\(1\)|\(2\)|\[초등학교|\[중학교|<\w",
                rest,
            )
            stmt = rest[: stop.start() if stop else 200]
            stmt = re.sub(r"\s+", " ", stmt).strip(" .•·")
            # Skip commentary-style tails
            if not stmt or stmt.startswith("은 ") or stmt.startswith("는 ") or stmt.startswith("과 "):
                continue
            if len(stmt) < 8:
                continue
            # Truncate long OCR bleed
            if len(stmt) > 300:
                # cut at last sentence-ish punctuation in first 300
                cut = max(stmt[:300].rfind("다."), stmt[:300].rfind("."))
                stmt = stmt[: cut + 2] if cut > 40 else stmt[:240]
            pairs.append((code, stmt))

    # Fallback: global scan if too few
    if len(pairs) < 50:
        for m in code_re.finditer(text):
            code = m.group(1)
            rest = text[m.end() : m.end() + 400]
            stop = re.search(r"\[[0-9]{1,2}[가-힣(]|\(가\)", rest)
            stmt = rest[: stop.start() if stop else 200]
            stmt = re.sub(r"\s+", " ", stmt).strip(" .•·")
            if stmt.startswith(("은 ", "는 ", "과 ", "와 ")):
                continue
            if len(stmt) >= 8:
                pairs.append((code, stmt[:240]))

    # Dedupe by code keeping longest statement
    best: dict[str, str] = {}
    for code, stmt in pairs:
        code = code.replace(" ", "")
        if code not in best or len(stmt) > len(best[code]):
            best[code] = stmt
    return [{"code": f"[{c}]", "raw": c, "statement": s} for c, s in sorted(best.items())]


def korean_meta(raw: str) -> dict:
    m = re.match(r"(\d+)국(\d{2})-(\d{2})", raw)
    if not m:
        m = re.match(r"(\d+)([가-힣]+)(\d{2})-(\d{2})", raw)
        band_num, subj, dom, num = m.group(1), m.group(2), m.group(3), m.group(4)
    else:
        band_num, dom, num = m.group(1), m.group(2), m.group(3)
        subj = "국"

    band_num_i = int(band_num)
    if band_num_i == 2:
        grade, band = "2", "1–2학년군"
    elif band_num_i == 4:
        grade, band = "4", "3–4학년군"
    elif band_num_i == 6:
        grade, band = "6", "5–6학년군"
    elif band_num_i == 9:
        grade, band = "9", "중학교 1–3학년"
    else:
        grade, band = "HS", f"고등 선택 ({subj})"

    domain_title = DOMAIN_TITLES_KO.get(dom, f"영역 {dom}")
    if band_num_i >= 12:
        domain_title = f"{subj} {dom}"
        domain_code = f"{subj}{dom}"
    else:
        domain_code = f"{band_num}국{dom}"

    return {
        "band": band,
        "gradeLevel": grade,
        "domainCode": domain_code,
        "domainTitle": domain_title,
        "subject": "국어" if subj == "국" or "국" in subj or subj in ("독작", "화언", "문학", "문영", "직의", "독토", "매의", "언탐", "주탐") else subj,
    }


def social_meta(raw: str) -> dict:
    raw_n = raw.replace(" ", "")
    # 9사(지리)01-01 / 9사(일사)01-01
    m = re.match(r"(\d+)사\(([^)]+)\)(\d{2})-(\d{2})", raw_n)
    if m:
        band_num, area, dom, num = m.group(1), m.group(2), m.group(3), m.group(4)
        grade, band = "9", f"중학교 사회({area})"
        return {
            "band": band,
            "gradeLevel": grade,
            "domainCode": f"9사({area}){dom}",
            "domainTitle": f"사회·{area} {dom}",
            "subject": f"사회({area})",
        }
    m = re.match(r"(\d+)역(\d{2})-(\d{2})", raw_n)
    if m:
        return {
            "band": "중학교 역사",
            "gradeLevel": "9",
            "domainCode": f"9역{m.group(2)}",
            "domainTitle": f"역사 {m.group(2)}",
            "subject": "역사",
        }
    m = re.match(r"(\d+)사(\d{2})-(\d{2})", raw_n)
    if m:
        band_num, dom, num = int(m.group(1)), m.group(2), m.group(3)
        if band_num == 4:
            grade, band = "4", "초등학교 3–4학년 사회"
        elif band_num == 6:
            grade, band = "6", "초등학교 5–6학년 사회"
        else:
            grade, band = "HS", "고등 사회"
        return {
            "band": band,
            "gradeLevel": grade,
            "domainCode": f"{band_num}사{dom}",
            "domainTitle": f"사회 {dom}",
            "subject": "사회",
        }
    m = re.match(r"(\d+)([가-힣]+)(\d{2})-(\d{2})", raw_n)
    if m:
        return {
            "band": f"고등 선택 ({m.group(2)})",
            "gradeLevel": "HS",
            "domainCode": f"{m.group(2)}{m.group(3)}",
            "domainTitle": f"{m.group(2)} {m.group(3)}",
            "subject": m.group(2),
        }
    return {
        "band": "기타",
        "gradeLevel": "HS",
        "domainCode": raw_n[:8],
        "domainTitle": raw_n,
        "subject": "사회",
    }


def extract_korean(pdf: Path) -> list[dict]:
    text = pdf_text(pdf)
    # include common + HS electives with 국/독작/화언/...
    code_re = re.compile(
        r"\[(\d{1,2}(?:국|독작|화언|문학|문영|직의|독토|매의|언탐|주탐)\d{2}[-–]\d{2})\]"
    )
    rows = parse_standards(text, code_re)
    out = []
    for r in rows:
        meta = korean_meta(r["raw"].replace("–", "-"))
        title = r["statement"][:60]
        out.append(
            {
                "code": r["code"].replace("–", "-"),
                "title": title,
                "statement": r["statement"],
                **meta,
            }
        )
    return out


def extract_social(pdf: Path) -> list[dict]:
    text = pdf_text(pdf)
    code_re = re.compile(
        r"\[("
        r"\d{1,2}사\(\s*[^)]+\s*\)\d{2}[-–]\d{2}"
        r"|\d{1,2}역\d{2}[-–]\d{2}"
        r"|\d{1,2}사\d{2}[-–]\d{2}"
        r"|\d{1,2}(?:정치와법|정치|경제|사회문화|사문|한탐|역현|법사|세사|세지|국관|금융|기지|도탐|동역|사탐|여지|지리|세계시민|윤리|생윤|철윤)[^\]]{0,6}\d{2}[-–]\d{2}"
        r"|\d{1,2}[가-힣]{1,4}\d{2}[-–]\d{2}"
        r")\]"
    )
    rows = parse_standards(text, code_re)
    out = []
    for r in rows:
        raw = r["raw"].replace("–", "-").replace(" ", "")
        # filter OCR junk
        if raw.endswith("-") or not re.search(r"\d{2}-\d{2}$", raw):
            continue
        if "국" in raw and "사" not in raw and "역" not in raw and "한" not in raw:
            # skip korean bleed
            continue
        meta = social_meta(raw)
        out.append(
            {
                "code": f"[{raw}]",
                "title": r["statement"][:60],
                "statement": r["statement"],
                **meta,
            }
        )
    return out


def main() -> None:
    IMPORTS.mkdir(exist_ok=True)
    ko_pdf = IMPORTS / "kr-korean-2022.pdf"
    so_pdf = IMPORTS / "kr-social-2022.pdf"
    if not ko_pdf.exists() or not so_pdf.exists():
        raise SystemExit("Missing PDFs in imports/ — download NCIC 별책 5/7 first")

    ko = extract_korean(ko_pdf)
    so = extract_social(so_pdf)
    (IMPORTS / "kr-korean-official.json").write_text(
        json.dumps(ko, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (IMPORTS / "kr-social-official.json").write_text(
        json.dumps(so, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"korean standards: {len(ko)}")
    print(f"social/history standards: {len(so)}")
    # band breakdown
    from collections import Counter

    print("korean grades", Counter(r["gradeLevel"] for r in ko))
    print("social grades", Counter(r["gradeLevel"] for r in so))
    print("social subjects", Counter(r["subject"] for r in so).most_common(20))


if __name__ == "__main__":
    main()
