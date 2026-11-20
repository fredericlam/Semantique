"""Per-language configuration and lexicon adapters.

A lexicon adapter yields LexEntry(form, lemma, pos, freq) where:
  - form  : any surface form a player might type ("chevaux")
  - lemma : the canonical word that is scored ("cheval"); must match model tokens
  - pos   : coarse part of speech: NOUN, ADJ, VERB, ADV, OTHER
  - freq  : lemma frequency (per million words), used for vocab filtering and secret picking
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator, NamedTuple

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"


class LexEntry(NamedTuple):
    form: str
    lemma: str
    pos: str
    freq: float


@dataclass
class Language:
    code: str
    timezone: str
    downloads: dict[str, str]          # local filename -> URL
    model_file: str                    # one of the downloads (after unzip if needed)
    lexicon: Callable[[Path], Iterator[LexEntry]]
    word_pattern: str                  # regex a lemma must fully match to be guessable
    secret_pos: tuple[str, ...] = ("NOUN", "ADJ", "VERB")
    secret_freq: tuple[float, float] = (4.0, 250.0)   # per million
    secret_len: tuple[int, int] = (4, 12)
    min_vocab_freq: float = 0.05
    credits: list[str] = field(default_factory=list)

    @property
    def raw_dir(self) -> Path:
        return RAW / self.code


# ---------------------------------------------------------------- French

_FR_POS = {"NOM": "NOUN", "ADJ": "ADJ", "VER": "VERB", "AUX": "VERB", "ADV": "ADV"}


def lexique383(raw: Path) -> Iterator[LexEntry]:
    path = raw / "Lexique383" / "Lexique383.tsv"
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            freq = float(r["freqlemfilms2"] or 0) + float(r["freqlemlivres"] or 0)
            yield LexEntry(
                form=r["ortho"].strip(),
                lemma=r["lemme"].strip(),
                pos=_FR_POS.get(r["cgram"], "OTHER"),  # "ADJ:pos", "ADJ:num"... are function words
                freq=freq / 2,
            )


FR = Language(
    code="fr",
    timezone="Europe/Paris",
    downloads={
        "Lexique383.zip": "http://www.lexique.org/databases/Lexique383/Lexique383.zip",
        "frWac_500_skip_cut100.bin":
            "https://embeddings.net/embeddings/frWac_no_postag_no_phrase_500_skip_cut100.bin",
    },
    model_file="frWac_500_skip_cut100.bin",
    lexicon=lexique383,
    word_pattern=r"[a-zàâäçéèêëîïôöùûüÿœæ]+(?:[-'][a-zàâäçéèêëîïôöùûüÿœæ]+)*",
    credits=[
        "Vecteurs : Jean-Philippe Fauconnier, frWac (CC-BY) — https://fauconnier.github.io/#data",
        "Lexique : Lexique 3.83, New & Pallier (CC BY-SA 4.0) — http://www.lexique.org",
    ],
)


# ---------------------------------------------------------------- English (prepared, not built yet)

def english_lexicon(raw: Path) -> Iterator[LexEntry]:
    # Planned: lemmas + inflections from a CC-licensed source (e.g. an UniMorph/Wiktionary
    # dump) and frequencies from SUBTLEX-US. Needs a lemmatised model to match `lemma`, or
    # a non-lemmatised model where `lemma == form` for base forms.
    raise NotImplementedError("English lexicon not wired yet — see README, section 'Anglais'.")


EN = Language(
    code="en",
    timezone="America/New_York",
    downloads={
        "cc.en.300.vec.gz": "https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.en.300.vec.gz",
    },
    model_file="cc.en.300.vec.gz",
    lexicon=english_lexicon,
    word_pattern=r"[a-z]+(?:[-'][a-z]+)*",
    credits=["Vectors: fastText Common Crawl (CC BY-SA 3.0)"],
)

LANGUAGES = {lang.code: lang for lang in (FR, EN)}
