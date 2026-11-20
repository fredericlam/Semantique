"""Build all game data for one language.

    .venv/bin/python pipeline/build.py fr --rounds 2000 --start 2026-11-20T00:00:00+01:00

Outputs (data/out/<lang>/):
  public/   — safe to ship to browsers (no secret inside)
    meta.json      vocab size, start time + round period, credits
    vocab.txt      guessable lemmas, one per line; line index = word id
    forms.json     {"forms": {form: id}, "loose": {accentless form: [ids, most frequent first]}}
    vec.bin        int8 [V x D] reduced vectors (grouping / 2D map of guesses)
  private/  — server only
    schedule.json  start, period, round number -> secret word (stable across re-runs; only appended)
    vectors.f32    float32 [V x dims] normalised vectors; the server scores each round from them
"""
from __future__ import annotations

import argparse
import hashlib
import datetime as dt
import json
import random
import re
import subprocess
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np

from languages import LANGUAGES, ROOT, Language
from w2v import load_word2vec

REDUCED_DIMS = 48
# The secret-word draw must not be reproducible from the (public) source code:
# its seed lives in an untracked file, created randomly on first build.
SEED_FILE = ROOT / "data" / "secret_seed"


def secret_seed() -> int:
    if not SEED_FILE.exists():
        SEED_FILE.parent.mkdir(parents=True, exist_ok=True)
        SEED_FILE.write_text(str(random.SystemRandom().getrandbits(64)))
    return int(SEED_FILE.read_text().strip())


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def download(lang: Language) -> None:
    lang.raw_dir.mkdir(parents=True, exist_ok=True)
    for name, url in lang.downloads.items():
        dest = lang.raw_dir / name
        if not dest.exists():
            print(f"↓ {url}")
            tmp = dest.with_suffix(dest.suffix + ".part")
            try:
                subprocess.run(["curl", "-fL", "--retry", "3", "-o", str(tmp), url], check=True)
            except FileNotFoundError:
                urllib.request.urlretrieve(url, tmp)
            tmp.rename(dest)
        if dest.suffix == ".zip":
            with zipfile.ZipFile(dest) as z:
                members = [m for m in z.namelist() if not m.startswith("__MACOSX")]
                if not all((lang.raw_dir / m).exists() for m in members):
                    z.extractall(lang.raw_dir, members)


def read_lexicon(lang: Language):
    lemma_freq: dict[str, float] = defaultdict(float)
    lemma_pos_freq: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    form_lemmas: dict[str, set[str]] = defaultdict(set)
    pattern = re.compile(lang.word_pattern)
    for e in lang.lexicon(lang.raw_dir):
        form, lemma = e.form.lower(), e.lemma.lower()
        if not pattern.fullmatch(lemma) or not pattern.fullmatch(form):
            continue
        lemma_pos_freq[lemma][e.pos] = max(lemma_pos_freq[lemma][e.pos], e.freq)
        form_lemmas[form].add(lemma)
    for lemma, by_pos in lemma_pos_freq.items():
        lemma_freq[lemma] = sum(by_pos.values())
    lemma_pos = {l: max(p.items(), key=lambda kv: kv[1])[0] for l, p in lemma_pos_freq.items()}
    return lemma_freq, lemma_pos, form_lemmas


def build_forms(vocab: list[str], freq: dict[str, float], form_lemmas: dict[str, set[str]]):
    index = {w: i for i, w in enumerate(vocab)}

    def best(lemmas):
        lemmas = [l for l in lemmas if l in index]
        return max(lemmas, key=lambda l: freq[l]) if lemmas else None

    forms: dict[str, int] = {}
    for form, lemmas in form_lemmas.items():
        if form in index:
            continue  # a lemma typed as-is always means itself
        lemma = best(lemmas)
        if lemma is not None:
            forms[form] = index[lemma]

    exact = set(index) | set(forms)
    loose_cands: dict[str, set[str]] = defaultdict(set)
    for form in exact:
        key = strip_accents(form)
        if key not in exact:
            loose_cands[key].add(vocab[forms[form]] if form in forms else form)
    # ambiguous accentless keys keep every candidate, most frequent first ("peche" → péché, pêche)
    loose = {k: [index[l] for l in sorted(v, key=lambda l: -freq[l])] for k, v in loose_cands.items()}
    # ligatures: the corpus writes "coeur", players type "cœur"
    for w, i in index.items():
        if "oe" in w or "ae" in w:
            forms.setdefault(w.replace("oe", "œ").replace("ae", "æ"), i)
    return forms, loose


def pick_secrets(lang, vocab, freq, pos, n_rounds, existing):
    lo, hi = lang.secret_freq
    lmin, lmax = lang.secret_len
    simple = re.compile(r"[^\W\d_]+")
    cands = sorted(
        w for w in vocab
        if pos.get(w) in lang.secret_pos and lo <= freq[w] <= hi
        and lmin <= len(w) <= lmax and simple.fullmatch(w)
    )
    blockfile = Path(__file__).parent / f"blocklist_{lang.code}.txt"
    if blockfile.exists():
        blocked = {l.strip() for l in blockfile.read_text().splitlines() if l.strip() and not l.startswith("#")}
        cands = [w for w in cands if w not in blocked]
    random.Random(f"{secret_seed()}:{lang.code}").shuffle(cands)
    used = set(existing)
    picked = list(existing)
    for w in cands:
        if len(picked) >= n_rounds:
            break
        if w not in used:
            picked.append(w)
            used.add(w)
    print(f"  {len(cands)} secret candidates, {len(picked)} rounds scheduled")
    return picked


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("lang", choices=sorted(LANGUAGES))
    ap.add_argument("--rounds", type=int, default=2000, help="number of secret words to schedule")
    ap.add_argument("--period", type=int, default=3600, help="seconds per round (first build only)")
    ap.add_argument("--start", default=None,
                    help="ISO datetime of round 1, e.g. 2026-11-20T00:00:00+01:00 (first build only)")
    args = ap.parse_args()

    lang = LANGUAGES[args.lang]
    out = ROOT / "data" / "out" / lang.code
    pub, priv = out / "public", out / "private"
    priv.mkdir(parents=True, exist_ok=True)
    pub.mkdir(parents=True, exist_ok=True)

    print("1/5 download"); download(lang)

    print("2/5 lexicon")
    freq, pos, form_lemmas = read_lexicon(lang)
    print(f"  {len(freq)} lemmas")

    print("3/5 vectors")
    # function words (pronouns, articles...) are excluded: they pollute neighbour lists
    keep = {l for l, f in freq.items() if f >= lang.min_vocab_freq and pos.get(l) != "OTHER"}
    words, M = load_word2vec(lang.raw_dir / lang.model_file, keep)
    order = sorted(range(len(words)), key=lambda i: -freq[words[i]])
    vocab = [words[i] for i in order]
    M = M[order]
    M /= np.linalg.norm(M, axis=1, keepdims=True)
    assert len(vocab) < 65535
    print(f"  vocab {len(vocab)} words, dim {M.shape[1]}")

    forms, loose = build_forms(vocab, freq, form_lemmas)
    print(f"  {len(forms)} inflected forms, {len(loose)} accentless keys")
    (pub / "vocab.txt").write_text("\n".join(vocab) + "\n", encoding="utf-8")
    (pub / "forms.json").write_text(
        json.dumps({"forms": forms, "loose": loose}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")

    print("4/5 reduced vectors")
    C = M - M.mean(axis=0)
    _, _, Vt = np.linalg.svd(C[:20000], full_matrices=False)
    R = C @ Vt[:REDUCED_DIMS].T
    R /= np.linalg.norm(R, axis=1, keepdims=True)
    (pub / "vec.bin").write_bytes(np.clip(np.round(R * 127), -127, 127).astype(np.int8).tobytes())

    print("5/5 schedule + server vectors")
    # One secret word per round (default: one round per hour). The server computes each round's
    # similarity table on demand from these vectors — precomputing 24 tables/day would be ~1 GB/year.
    (priv / "vectors.f32").write_bytes(M.astype("<f4").tobytes())
    sched_path = priv / "schedule.json"
    sched = json.loads(sched_path.read_text()) if sched_path.exists() else None
    if sched:
        start, period = sched["start"], sched["period"]
    else:
        start = args.start or dt.datetime.now().astimezone().replace(minute=0, second=0, microsecond=0).isoformat()
        start = dt.datetime.fromisoformat(start).isoformat()  # validate
        period = args.period
    existing = [w for w in (sched["words"] if sched else []) if w in set(vocab)]
    secrets = pick_secrets(lang, vocab, freq, pos, args.rounds, existing)
    sched_path.write_text(json.dumps({"start": start, "period": period, "words": secrets}, ensure_ascii=False, indent=0))

    meta = {
        "lang": lang.code, "timezone": lang.timezone,
        "start": start, "period": period, "rounds": len(secrets),
        "vocabSize": len(vocab), "dims": int(M.shape[1]), "vecDims": REDUCED_DIMS,
        "credits": lang.credits,
        # cache-busting key for public files; changes whenever the vocabulary does
        "version": hashlib.sha1("\n".join(vocab).encode()).hexdigest()[:10],
    }
    (pub / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"done → {out}")


if __name__ == "__main__":
    main()
