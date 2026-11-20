"""Guess the key (tonic + major / minor) of a song from its chords.

The dataset doesn't give the key, and roman numerals only mean something relative to it.

Method (classic "key profile" idea, Krumhansl & Kessler): count how often each of the 12
notes is heard in the chords, then compare that histogram with the typical profile of each
of the 24 keys. On top of that, the tonic chord tends to start and end a song and to come
back often: we add a small bonus for that. Not perfect (relative major / minor, modal songs
are hard), but good enough to compare thousands of songs.
"""

from chords import TRIAD_NOTES

# How strongly each degree "belongs" to a major / minor key (listening experiments).
MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


def correlation(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = sum((x - ma) ** 2 for x in a) ** 0.5
    db = sum((y - mb) ** 2 for y in b) ** 0.5
    return num / (da * db) if da and db else 0.0


def tonic_chords(chords):
    """How many chords are a possible tonic chord, per (tonic, minor?). A chord with no
    third (sus, power chord) counts for both major and minor."""
    count = {}
    for c in chords:
        if c["triad"] in ("maj", "open"):
            count[c["root"], False] = count.get((c["root"], False), 0) + 1
        if c["triad"] in ("min", "open"):
            count[c["root"], True] = count.get((c["root"], True), 0) + 1
    return count


def estimate_key(chords, starts=None):
    """chords: parsed chords of the whole song, in order; starts: the first chord of each
    section (verse, chorus…). Returns (tonic 0–11, minor?)."""
    starts = starts or chords[:1]
    hist = [0.0] * 12
    for c in chords:
        for i in TRIAD_NOTES[c["triad"]]:
            hist[(c["root"] + i) % 12] += 1
        hist[c["root"]] += 1  # the root counts a bit more
        if c["bass"] is not None:
            hist[c["bass"]] += 0.5

    # Counted once here, rather than once per key below: there are 680,000 songs.
    in_song, at_start, at_end = tonic_chords(chords), tonic_chords(starts), tonic_chords(chords[-1:])

    best, best_score = (0, False), float("-inf")
    for tonic in range(12):
        for minor, profile in ((False, MAJOR), (True, MINOR)):
            rotated = [profile[(i - tonic) % 12] for i in range(12)]
            score = correlation(hist, rotated)
            # Bonus: the tonic chord comes back often, starts the sections, ends the song.
            k = (tonic, minor)
            score += 0.4 * in_song.get(k, 0) / len(chords)
            score += 0.4 * at_start.get(k, 0) / len(starts)
            score += 0.2 * at_end.get(k, 0)
            if score > best_score:
                best, best_score = k, score
    return best


if __name__ == "__main__":
    # Quick self-check: python3 key.py
    from chords import parse

    names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    tests = {
        "C major": "C F C E7 Amin C F C G7 C F C E7 Amin C F G7 C",
        "C# minor": "Csmin A Csmin A Csmin A B Csmin A Fsmin A B",
        "D major": "D Dmaj7 D Dmaj7 Emin A D G Emin A D G D/Fs Emin A D",
        "A minor (i VI III VII)": "Amin F C G Amin F C G Amin",
        "C major (IV V I vi)": "F G C Amin F G C Amin F G C",
        "E (rock, bVII)": "E D A/Cs E D A/Cs E G D A E G D A E",
    }
    for label, line in tests.items():
        tonic, minor = estimate_key([parse(t) for t in line.split()])
        print(f"{label:24} → {names[tonic]} {'minor' if minor else 'major'}")
