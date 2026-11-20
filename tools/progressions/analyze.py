"""Find chord progressions typical of a style, from ~680,000 songs (Chordonomicon).

    python3 analyze.py              # whole dataset (a few minutes)
    python3 analyze.py --limit 50000  # quicker try on the first songs

Steps, for each song:
  1. read its chords section by section (verse, chorus…) and guess its key (key.py);
  2. turn each chord into a roman numeral (chords.py): 'Am F C G' in A minor → i bVI bIII bVII;
  3. slide a window of 4 chords along each section: each window is a progression.
Then, per style (styles.py), keep the progressions used by many songs of the style but
few songs elsewhere ("lift"), the same idea as TF-IDF for words in documents.

Writes `out/report.md` (to read) and `../../progressions/data.js` (for the web tool).
Data: Chordonomicon, CC BY-NC 4.0 (attribution, non-commercial).
"""

import argparse
import csv
import json
import math
import os
import re
import sys
import urllib.request
from collections import Counter, defaultdict

from chords import full_numeral, numeral, parse
from key import estimate_key
from styles import STYLES, styles_of

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data", "chordonomicon_v2.csv")
URL = "https://huggingface.co/datasets/ailsntua/Chordonomicon/resolve/main/chordonomicon_v2.csv"
REPORT = os.path.join(HERE, "out", "report.md")
WEB = os.path.join(HERE, "..", "..", "progressions", "data.js")

SIZE = 4          # chords per progression
PER_STYLE = 30    # progressions kept per style
MIN_LIFT = 2.0    # at least twice as common in the style as in all songs…
BIG_LIFT = 1.4    # …or 1.4× for big styles (rock, pop): they weigh a lot in "all songs"
COMMON = 25       # the most common progressions overall, for reference

csv.field_size_limit(10**9)


def download():
    print(f"Downloading the dataset (264 MB) to {os.path.normpath(DATA)}…")
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    urllib.request.urlretrieve(URL, DATA)


def songs(limit):
    """Yields (styles, sections, spotify id). A section is a list of parsed chords."""
    with open(DATA, newline="", encoding="utf-8") as f:
        for i, row in enumerate(csv.DictReader(f)):
            if limit and i >= limit:
                return
            sections, current = [], None
            for tok in row["chords"].split():
                if tok.startswith("<"):  # section tag: <verse_1>, <chorus_2>…
                    current = []
                    sections.append(current)
                    continue
                chord = parse(tok)
                if chord:
                    if current is None:
                        current = []
                        sections.append(current)
                    current.append(chord)
            sections = [s for s in sections if s]
            if sum(len(s) for s in sections) >= SIZE:
                tags = re.findall(r"'([^']*)'", row["genres"])
                yield styles_of(tags), sections, row["spotify_song_id"]


def windows(sections):
    """For one song: (skeleton, colours) for each window of SIZE chords.
    skeleton = bare numerals ('vi', 'IV'…), colours = full numerals ('vi7', 'IVmaj7'…)."""
    chords = [c for s in sections for c in s]
    tonic, minor = estimate_key(chords, [s[0] for s in sections])
    for section in sections:
        seq = []
        for c in section:
            bare = numeral(c, tonic, minor)
            if not seq or seq[-1][0] != bare:  # a repeated chord is the same chord, held
                seq.append((bare, full_numeral(c, tonic, minor)))
        for i in range(len(seq) - SIZE + 1):
            w = seq[i:i + SIZE]
            yield tuple(b for b, _ in w), tuple(f for _, f in w)


def cycle(skeleton, colours):
    """Progressions loop, so a window can hide a shorter loop:
    'i bVII i bVII' is the 2-chord loop 'i bVII', 'I IV V I' is the 3-chord loop 'I IV V'.
    Returns the window cut to its real length, and a key shared by all its rotations:
    'I V vi IV' and 'vi IV I V' are the same loop started elsewhere."""
    s = skeleton
    size = 2 if s[0] == s[2] and s[1] == s[3] else 3 if s[0] == s[3] else len(s)
    s, colours = s[:size], colours[:size]
    key = min(s[i:] + s[:i] for i in range(size))
    return key, s, colours


def first_pass(limit):
    """Counts, for each loop, how many songs use it: in total and per style."""
    total, by_style, rotations = Counter(), defaultdict(Counter), Counter()
    songs_in, n = Counter(), 0
    for styles, sections, _ in songs(limit):
        n += 1
        for s in styles:
            songs_in[s] += 1
        seen = {}
        for window in windows(sections):
            k, start, _ = cycle(*window)
            if k not in seen:
                seen[k] = start  # how this song starts the loop
        for k, start in seen.items():
            total[k] += 1
            rotations[k, start] += 1
            for s in styles:
                by_style[s][k] += 1
        if n % 50000 == 0:
            print(f"  {n} songs…", file=sys.stderr)
    return n, total, by_style, rotations, songs_in


def pick(n, total, by_style, songs_in):
    """The progressions to keep: per style, frequent in the style and rare elsewhere."""
    chosen = {"common": [(k, total[k], 1.0) for k, _ in total.most_common(COMMON)]}
    for sid, *_ in STYLES:
        size = songs_in[sid]
        if not size:
            continue
        floor = max(10, size * 0.004)  # used by enough songs to be a real habit
        scored = []
        for k, c in by_style[sid].items():
            if c < floor:
                continue
            share, overall = c / size, total[k] / n
            lift = share / overall
            if lift >= (BIG_LIFT if size > n * 0.05 else MIN_LIFT):
                scored.append((share * math.log(lift), k, c, lift))
        scored.sort(reverse=True)
        chosen[sid] = [(k, c, lift) for _, k, c, lift in scored[:PER_STYLE]]
    return chosen


def rotate_to(skeleton, colours, start):
    """Turn a loop so it starts like `start` (the usual way to start this loop)."""
    for i in range(len(skeleton)):
        if skeleton[i:] + skeleton[:i] == start:
            return colours[i:] + colours[:i]
    return None


def second_pass(limit, chosen, display):
    """For the chosen loops only: their usual colours (7ths, 9ths…) and example songs."""
    wanted = defaultdict(set)  # loop → styles where it was chosen
    for sid, items in chosen.items():
        for k, *_ in items:
            wanted[k].add(sid)
    colours = defaultdict(Counter)   # (style, loop) → colour variant → songs
    examples = defaultdict(list)     # (style, loop) → spotify ids
    for styles, sections, spotify in songs(limit):
        styles = styles | {"common"}
        seen = {}
        for window in windows(sections):
            k, skeleton, colour = cycle(*window)
            if k in wanted and k not in seen:
                seen[k] = rotate_to(skeleton, colour, display[k])
        for k, colour in seen.items():
            for sid in wanted[k] & styles:
                colours[sid, k][colour] += 1
                if spotify and len(examples[sid, k]) < 3:
                    examples[sid, k].append(spotify)
    return colours, examples


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="only read the first N songs")
    args = ap.parse_args()
    if not os.path.exists(DATA):
        download()

    print("Pass 1: counting progressions…")
    n, total, by_style, rotations, songs_in = first_pass(args.limit)
    chosen = pick(n, total, by_style, songs_in)

    # Show each loop the way songs usually start it.
    display = {}
    for (k, start), c in rotations.items():
        if k not in display or c > rotations[k, display[k]]:
            display[k] = start
    print("Pass 2: colours and examples…")
    colours, examples = second_pass(args.limit, chosen, display)

    labels = {"common": "Most common (all songs)"} | {sid: label for sid, label, *_ in STYLES}
    songs_in["common"] = n
    result = []
    for sid, items in chosen.items():
        progs = []
        for k, count, lift in items:
            variants = colours[sid, k].most_common()
            progs.append({
                "roman": list(display[k]),
                "colours": [[list(v), c] for v, c in variants[:4]],
                "songs": count,
                "share": round(count / songs_in[sid], 4),
                "lift": round(lift, 1),
                "examples": examples[sid, k],
            })
        result.append({"id": sid, "label": labels[sid], "songs": songs_in[sid], "progressions": progs})

    write_report(n, result)
    write_web(n, result)
    print(f"Done: {n} songs. Wrote {os.path.normpath(REPORT)} and {os.path.normpath(WEB)}")


def write_report(n, styles):
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    lines = [
        "# Chord progressions by style",
        "",
        f"From {n:,} songs of Chordonomicon (CC BY-NC 4.0). Numerals are relative to the",
        "guessed tonic: `bVII` = a whole tone below the tonic, lower case = minor chord.",
        "**Lift** = how many times more common in the style than in all songs.",
        "**Colours** = the most common versions with sevenths / extensions, with song counts.",
        "",
    ]
    for st in styles:
        lines += [f"## {st['label']} ({st['songs']:,} songs)", "", "| Progression | Songs | In style | Lift | Colours |", "|---|---|---|---|---|"]
        for p in st["progressions"]:
            coloured = [v for v in p["colours"] if v[0] != p["roman"]][:2]
            col = " · ".join(f"{' '.join(v)} ({c})" for v, c in coloured)
            lines.append(f"| **{' '.join(p['roman'])}** | {p['songs']} | {p['share']:.1%} | ×{p['lift']} | {col} |")
        lines.append("")
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def write_web(n, styles):
    os.makedirs(os.path.dirname(WEB), exist_ok=True)
    with open(WEB, "w", encoding="utf-8") as f:
        f.write("// Generated by tools/progressions/analyze.py: do not edit by hand.\n")
        f.write(f"// Derived from Chordonomicon ({n:,} songs), CC BY-NC 4.0:\n")
        f.write("// https://huggingface.co/datasets/ailsntua/Chordonomicon (non-commercial use only).\n")
        f.write("const PROGRESSION_DATA = ")
        json.dump({"songs": n, "styles": styles}, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")


if __name__ == "__main__":
    main()
