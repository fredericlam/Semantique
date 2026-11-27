"""Build all game data for one language.

    .venv/bin/python pipeline/build.py fr --rounds 2000 --start 2026-11-20T00:00:00+01:00

Outputs (data/out/<lang>/):
  public/   — safe to ship to browsers (no secret inside)
    meta.json      vocab size, start time + round period, credits
    vocab.txt      guessable lemmas, one per line; line index = word id
    forms.json     {"forms": {form: id}, "loose": {accentless form: [ids, most frequent first]}}
    vec.bin        int8 [V x D] reduced vectors (grouping / 2D map of guesses)
  private/  — server only
    <level>/schedule.json   start, period, round number -> secret word (stable across re-runs; only appended)
    <level>/rounds/NNNN.bin CHUNK rounds per file; each round = int16[V] similarity*10000 + uint16[V] rank (0 = secret)
    levels: kid / teen / adult (see languages.py) — same guessable vocabulary, different secret words
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

from languages import LANGUAGES, ROOT, Language, Level
from w2v import load_word2vec

REDUCED_DIMS = 48
CHUNK = 100  # rounds per table file
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


def blocklist(name: str) -> set[str]:
    f = Path(__file__).parent / name
    if not f.exists():
        return set()
    return {l.strip() for l in f.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")}


def candidates(lang: Language, level: Level, vocab, freq, pos, M) -> list[str]:
    lo, hi = level.freq
    lmin, lmax = level.length
    simple = re.compile(r"[^\W\d_]+")
    suffix = re.compile(level.exclude_suffixes) if level.exclude_suffixes else None
    blocked = blocklist(f"blocklist_{lang.code}.txt") | blocklist(f"blocklist_{lang.code}_{level.name}.txt")
    cands = [
        w for w in vocab
        if pos.get(w) in level.pos and lo <= freq[w] <= hi and lmin <= len(w) <= lmax
        and simple.fullmatch(w) and w not in blocked and not (suffix and suffix.search(w))
    ]
    if level.themes:
        index = {w: i for i, w in enumerate(vocab)}
        P = M[[index[w] for w in level.themes if w in index]]
        top3 = lambda w: float(np.sort(P @ M[index[w]])[-3:].mean())
        cands = [w for w in cands if top3(w) >= level.theme_min]
    return sorted(cands)


def pick_secrets(lang: Language, level: Level, cands: list[str], n_rounds: int, existing: list[str]) -> list[str]:
    """Keep the existing schedule, then append shuffled candidates. When candidates run out
    (small kid list), start a new shuffled cycle, avoiding words seen in the last half-cycle."""
    picked = list(existing)
    cycle = 0
    while len(picked) < n_rounds and cands:
        order = list(cands)
        tag = f"{secret_seed()}:{lang.code}" if level.name == "adult" else f"{secret_seed()}:{lang.code}:{level.name}"
        random.Random(f"{tag}:{cycle}" if cycle else tag).shuffle(order)
        recent = set(picked[-(len(cands) // 2):]) if cycle else set(picked)
        for w in order:
            if len(picked) >= n_rounds:
                break
            if w not in recent:
                picked.append(w)
                recent.add(w)
        cycle += 1
        if cycle > 1000:
            break
    print(f"  [{level.name}] {len(cands)} candidates, {len(picked)} rounds, {len(set(picked))} distinct words")
    return picked


def write_rounds(dir_: Path, secrets: list[str], vocab: list[str], M: np.ndarray) -> None:
    # Round tables, precomputed so the server only reads (Workers free plan: 10 ms CPU per request).
    # Packed CHUNK rounds per file; the server range-reads the 4·V bytes of one round.
    index = {w: i for i, w in enumerate(vocab)}
    dir_.mkdir(parents=True, exist_ok=True)
    V = len(vocab)
    for c0 in range(0, len(secrets), CHUNK):
        parts = []
        for w in secrets[c0:c0 + CHUNK]:
            sims = M @ M[index[w]]
            sims[index[w]] = 2.0  # secret always first
            ranks = np.empty(V, dtype=np.uint16)
            ranks[np.argsort(-sims, kind="stable")] = np.arange(V, dtype=np.uint16)
            sims[index[w]] = 1.0
            parts.append(np.clip(np.round(sims * 10000), -10000, 10000).astype("<i2").tobytes())
            parts.append(ranks.astype("<u2").tobytes())
        (dir_ / f"{c0 // CHUNK:04d}.bin").write_bytes(b"".join(parts))


def read_themes(lang: Language, vocab_set: set[str]) -> list[tuple[str, list[str]]]:
    """pipeline/themes_<lang>_kid.txt: '## <emoji> <name>' headers, then words."""
    f = Path(__file__).parent / f"themes_{lang.code}_kid.txt"
    if not f.exists():
        return []
    themes, seen, missing = [], set(), []
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("##"):
            themes.append((line[2:].strip(), []))
        elif line and not line.startswith("#") and themes:
            for w in line.split():
                if w not in vocab_set:
                    missing.append(w)
                elif w not in seen:
                    seen.add(w)
                    themes[-1][1].append(w)
    if missing:
        print(f"  [bonus] not in the vocabulary, skipped: {' '.join(missing)}")
    return [t for t in themes if t[1]]


def write_bonus(lang: Language, priv: Path, vocab: list[str], M: np.ndarray) -> None:
    """Bonus words of the easy rooms: the themes taken in turn (one word of each, then again),
    each theme in a shuffled order. Rooms walk this list; it can be rebuilt freely (rooms keep the words they played)."""
    themes = read_themes(lang, set(vocab))
    if not themes:
        return
    rng = random.Random(f"{secret_seed()}:{lang.code}:bonus")
    queues = [rng.sample(words, len(words)) for _, words in themes]
    words, theme = [], []
    while any(queues):
        for i, q in enumerate(queues):
            if q:
                words.append(q.pop(0))
                theme.append(i)
    d = priv / "bonus"
    d.mkdir(parents=True, exist_ok=True)
    if (d / "rounds").exists():
        for f in (d / "rounds").iterdir():
            f.unlink()
    (d / "schedule.json").write_text(json.dumps(
        {"themes": [name for name, _ in themes], "words": words, "theme": theme}, ensure_ascii=False, indent=0), encoding="utf-8")
    write_rounds(d / "rounds", words, vocab, M)
    print(f"  [bonus] {len(themes)} themes, {len(words)} words")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("lang", choices=sorted(LANGUAGES))
    ap.add_argument("--rounds", type=int, default=2000, help="number of secret words to schedule")
    ap.add_argument("--period", type=int, default=3600, help="seconds per round (first build only)")
    ap.add_argument("--replan", action="append", default=[], metavar="LEVEL:ROUND",
                    help="keep LEVEL's schedule up to ROUND (included) and re-draw the following words "
                         "with the current filters, e.g. kid:73. Words already played never change.")
    ap.add_argument("--start", default=None,
                    help="ISO datetime of round 1, e.g. 2026-11-20T00:00:00+01:00 (first build only)")
    ap.add_argument("--bonus-only", action="store_true",
                    help="only rebuild the bonus words of the easy rooms (pipeline/themes_<lang>_kid.txt)")
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

    if args.bonus_only:
        print("5/5 bonus words"); write_bonus(lang, priv, vocab, M)
        print(f"done → {priv / 'bonus'}")
        return

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

    print("5/5 schedules + round tables (per level)")
    # one-time migration: the original single schedule becomes the "adult" one, unchanged
    legacy = priv / "schedule.json"
    if legacy.exists() and not (priv / "adult" / "schedule.json").exists():
        (priv / "adult").mkdir(exist_ok=True)
        legacy.rename(priv / "adult" / "schedule.json")
    if (priv / "rounds").exists():
        for f in (priv / "rounds").iterdir():
            f.unlink()
        (priv / "rounds").rmdir()

    start = period = None
    for name in lang.levels:
        sched_path = priv / name / "schedule.json"
        sched = json.loads(sched_path.read_text()) if sched_path.exists() else None
        if sched and start is None:
            start, period = sched["start"], sched["period"]
    if start is None:
        start = args.start or dt.datetime.now().astimezone().replace(minute=0, second=0, microsecond=0).isoformat()
        start = dt.datetime.fromisoformat(start).isoformat()  # validate
        period = args.period

    vocab_set = set(vocab)
    replan = {k: int(v) for k, v in (r.split(":") for r in args.replan)}
    rounds_per_level = {}
    for name, level in lang.levels.items():
        sched_path = priv / name / "schedule.json"
        sched_path.parent.mkdir(parents=True, exist_ok=True)
        sched = json.loads(sched_path.read_text()) if sched_path.exists() else None
        existing = [w for w in (sched["words"] if sched else []) if w in vocab_set]
        if name in replan:
            print(f"  [{name}] keeping rounds 1–{replan[name]}, re-drawing the rest")
            existing = existing[: replan[name]]
        secrets = pick_secrets(lang, level, candidates(lang, level, vocab, freq, pos, M), args.rounds, existing)
        sched_path.write_text(json.dumps({"start": start, "period": period, "words": secrets}, ensure_ascii=False, indent=0))
        write_rounds(priv / name / "rounds", secrets, vocab, M)
        rounds_per_level[name] = len(secrets)

    write_bonus(lang, priv, vocab, M)

    meta = {
        "lang": lang.code, "timezone": lang.timezone,
        "start": start, "period": period, "rounds": min(rounds_per_level.values()), "chunk": CHUNK,
        "levels": list(lang.levels), "defaultLevel": "adult" if "adult" in lang.levels else next(iter(lang.levels)),
        "vocabSize": len(vocab), "dims": int(M.shape[1]), "vecDims": REDUCED_DIMS,
        "credits": lang.credits,
        # cache-busting key for public files; changes whenever the vocabulary does
        "version": hashlib.sha1("\n".join(vocab).encode()).hexdigest()[:10],
    }
    (pub / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"done → {out}")


if __name__ == "__main__":
    main()
