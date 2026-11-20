"""Chord symbols: read them, and write them as roman numerals.

Chordonomicon writes chords like `Csmin7`, `D/Fs`, `Gno3d`: a root note (`s` = sharp,
`b` = flat), a quality (`min7`, `maj7`, `sus4`, `no3d` = power chord…) and maybe a bass.
"""

import re

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

# Root: a letter, then `s` (sharp) or `b` (flat). Careful: in `Csus4` the `s` starts "sus".
CHORD_RE = re.compile(r"^([A-G])(s(?!us)|b)?([^/]*)(?:/([A-G])(s|b)?)?$")

# Degrees counted in semitones above the tonic, in the usual roman spelling.
ROMAN = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"]
DEGREE = ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"]

# Dataset quality → the way musicians write it. Anything else is cleaned up by `tidy()`.
QUALITY = {
    "": "", "min": "m", "7": "7", "min7": "m7", "maj7": "maj7", "no3d": "5",
    "add9": "add9", "sus4": "sus4", "sus2": "sus2", "add13": "6", "minadd13": "m6",
    "add11": "add11", "minadd9": "madd9", "minadd11": "madd11", "dim": "°", "dim7": "°7",
    "aug": "+", "augmaj7": "+maj7", "minmaj7": "m(maj7)", "maj911s": "maj9#11",
}


def tidy(q):
    """Fallback for rarer qualities: 'min11' → 'm11', '13b' → '7b13'…"""
    q = q.replace("min", "m").replace("no3d", "5").replace("dim", "°").replace("aug", "+")
    q = re.sub(r"(\d+)s(?!us)", r"#\1", q)  # '11s' → '#11' (but not '7sus2')
    return q


def parse(token):
    """'Csmin7/E' → {'root': 1, 'triad': 'min', 'quality': 'm7', 'bass': 4}, or None."""
    m = CHORD_RE.match(token)
    if not m:
        return None
    letter, acc, q, bass_letter, bass_acc = m.groups()
    root = (NOTE[letter] + {"s": 1, "b": -1}.get(acc, 0)) % 12
    bass = None
    if bass_letter:
        bass = (NOTE[bass_letter] + {"s": 1, "b": -1}.get(bass_acc, 0)) % 12
        if bass == root:
            bass = None

    # The triad tells major / minor: that's what the case of the numeral shows (V / v).
    if q.startswith("min"):
        triad = "min"
    elif q.startswith("dim"):
        triad = "dim"
    elif q.startswith("aug"):
        triad = "aug"
    elif "sus" in q or q.startswith("no3d"):
        triad = "open"  # no third: neither major nor minor
    else:
        triad = "maj"
    return {"root": root, "triad": triad, "quality": QUALITY.get(q, tidy(q)), "bass": bass}


# The notes of each triad, in semitones above the root (used to guess the key).
TRIAD_NOTES = {"maj": (0, 4, 7), "min": (0, 3, 7), "dim": (0, 3, 6), "aug": (0, 4, 8), "open": (0, 7)}


# Degrees whose chord is minor in the key's own scale: ii iii vi in major, i iv v in minor.
# A chord with no third (power chord, sus) takes the case its degree has in the scale.
MINOR_DEGREES = {False: {2, 4, 9, 11}, True: {0, 2, 5, 7}}


def is_lower(chord, tonic, minor):
    if chord["triad"] == "open":
        return (chord["root"] - tonic) % 12 in MINOR_DEGREES[minor]
    return chord["triad"] in ("min", "dim")


def numeral(chord, tonic, minor=False):
    """The bare numeral, ignoring sevenths and colours: 'vi', 'bVII', 'vii°'.
    Two songs with the same bare numerals have the same harmonic skeleton."""
    r = ROMAN[(chord["root"] - tonic) % 12]
    if is_lower(chord, tonic, minor):
        r = r.lower()
    if chord["triad"] == "dim":
        r += "°"
    elif chord["triad"] == "aug":
        r += "+"
    return r


def full_numeral(chord, tonic, minor=False):
    """The numeral with its colour and bass: 'vi7', 'IVmaj7', 'IV/5' (F/G in C)."""
    r = ROMAN[(chord["root"] - tonic) % 12]
    q = chord["quality"]
    if is_lower(chord, tonic, minor):
        r = r.lower()
        if q.startswith("m") and not q.startswith("maj"):
            q = q[1:]  # lower case already says minor: 'vi7', not 'vim7'
    s = r + q
    if chord["bass"] is not None:
        s += "/" + DEGREE[(chord["bass"] - tonic) % 12]
    return s


if __name__ == "__main__":
    # Quick self-check: python3 chords.py
    for t in ["C", "Amin", "Csmin7", "Csus4", "Cssus4", "D/Fs", "Gno3d", "Ano3d", "Bbmaj7", "Bdim", "Fmaj911s"]:
        c = parse(t)
        print(f"{t:8} → {c}  in C: {numeral(c, 0):6} {full_numeral(c, 0)}")
