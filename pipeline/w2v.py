"""Minimal word2vec binary / text loader (no gensim dependency)."""
from __future__ import annotations

import gzip
from pathlib import Path

import numpy as np


def load_word2vec(path: Path, keep: set[str] | None = None) -> tuple[list[str], np.ndarray]:
    """Load vectors; if `keep` is given, only words in it are retained."""
    if path.suffix == ".gz" or path.name.endswith(".vec") or path.name.endswith(".txt"):
        return _load_text(path, keep)
    return _load_bin(path, keep)


def _load_bin(path: Path, keep: set[str] | None) -> tuple[list[str], np.ndarray]:
    words: list[str] = []
    vecs: list[np.ndarray] = []
    with open(path, "rb") as f:
        n, dim = map(int, f.readline().split())
        nbytes = 4 * dim
        for _ in range(n):
            chars = bytearray()
            while True:
                c = f.read(1)
                if c == b" ":
                    break
                if c == b"":
                    raise EOFError("truncated word2vec file")
                if c != b"\n":
                    chars += c
            vec = f.read(nbytes)
            word = chars.decode("utf-8", errors="replace")
            if keep is None or word in keep:
                words.append(word)
                vecs.append(np.frombuffer(vec, dtype="<f4"))
    return words, np.vstack(vecs).astype(np.float32)


def _load_text(path: Path, keep: set[str] | None) -> tuple[list[str], np.ndarray]:
    opener = gzip.open if path.suffix == ".gz" else open
    words: list[str] = []
    vecs: list[np.ndarray] = []
    with opener(path, "rt", encoding="utf-8", errors="replace") as f:
        first = f.readline().split()
        if len(first) != 2:  # no header line
            f.seek(0)
        for line in f:
            parts = line.rstrip().split(" ")
            word = parts[0]
            if keep is None or word in keep:
                words.append(word)
                vecs.append(np.asarray(parts[1:], dtype=np.float32))
    return words, np.vstack(vecs)
