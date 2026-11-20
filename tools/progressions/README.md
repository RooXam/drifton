# Chord progressions by style (Python)

Offline analysis that feeds the future `progressions/` page. Plain Python 3, nothing to
install. It finds progressions that are **typical of a style but rare elsewhere**, rather
than the I–IV–V loops every app offers.

```sh
cd tools/progressions
python3 analyze.py                # whole dataset, ~10 min; downloads it the first time
python3 analyze.py --limit 30000  # quick try
```

| File | Role |
|---|---|
| `chords.py` | read a chord symbol (`Csmin7`, `D/Fs`, `Gno3d`) and write it as a roman numeral |
| `key.py` | guess a song's key from its chords (key profiles + tonic-chord bonus) |
| `styles.py` | group Spotify genre tags into ~18 styles (hip-hop, R&B · neo soul, jazz…) |
| `analyze.py` | count 4-chord windows per style, score them, write the outputs |

Outputs:
- `out/report.md`: tables to read, one per style.
- `../../progressions/data.js`: the same data for the web page (`PROGRESSION_DATA`).

## How it works

1. **Key.** The dataset doesn't give it. We count the notes heard in the chords and compare
   with the typical profile of each of the 24 keys, plus a bonus for the chord that opens
   the sections and ends the song. Relative major / minor and modal songs stay ambiguous.
2. **Numerals.** Each chord becomes a degree above the tonic, written the chromatic way:
   `bVII` = a whole tone below the tonic, lower case = minor. Two levels: the bare
   skeleton (`vi`) is what we count (a power chord takes the case of its degree in the
   scale: `vi5`); the colour (`vi7`, `IVmaj7`, `IV/5` = IV over the 5th)
   is kept to show how the style dresses the progression.
3. **Windows.** Within each section, repeated chords are merged, then a window of 4 chords
   slides along. A window can hide a shorter loop (`i bVII i bVII` → `i bVII`), and all
   rotations of a loop count as one (`I V vi IV` = `vi IV I V`), shown the way songs
   usually start it.
4. **Score.** Per style: share of the style's songs using the loop × log(lift), where
   lift = how many times more common in the style than in all songs (like TF-IDF). Kept
   if used by at least 0.4 % of the style's songs (min 10) and lift ≥ 2 (≥ 1.4 for big
   styles like rock or pop, which weigh a lot in "all songs").

## Data and license

[Chordonomicon](https://huggingface.co/datasets/ailsntua/Chordonomicon) (arXiv 2410.22046),
~680,000 songs, **CC BY-NC 4.0**: free with attribution, **non-commercial only**. The CSV
(264 MB) lands in `tools/data/`, which git ignores. `progressions/data.js` is derived
from it, so it carries the same license: if Drifton ever becomes paid, it has to be
rebuilt from other sources or cleared with the authors.
