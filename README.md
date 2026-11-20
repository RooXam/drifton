# Drifton

Small sound tools that run in your browser: listen, play, learn, make.

A collection of simple tools around sound, sharing the same home-made Web Audio engine
and design: generative functional music to focus or relax, a piano practice player,
chord progressions by style, a synth… No dependencies, no server. See [`ROADMAP.md`](ROADMAP.md).

Live: https://rooxam.github.io/drifton/

## Use

**Double-click `index.html`**: the home page links to every part. Each part also
works on its own by double-clicking its `index.html`.

| Tool | Folder | What it is |
|---|---|---|
| Focus music | `generator/` | Press play: five instruments played by rules (pad, bass, soft piano, bells, texture), modal harmony, voice-led chords, moods from Deep focus to a still Drone |
| Synth | `synth/` | The home-made synth: play the instruments from the keyboard and shape their sound |
| Pad states | `pads/` | Early prototype: one pad in three states crossfaded by a conductor, granular layer, amplitude modulation |
| Piano score | `score/` | Open a `.mid` file and practice: falling notes on a keyboard, speed, loop on bars, see / hear each hand |
| Chords | `chords/` | A guessing game to learn guitar chords: a playable chord chart (touch a string, slide to strum), hints one by one, by ear mode |
| Songbook | `songbook/` | Songs to play on guitar: chords of each part, shapes, numerals, transpose, play along. Paste your own songs or lyrics: they stay on your device (`library.js`), with export / import |
| Chord progressions | `progressions/` | Progressions typical of a style (from 680,000 songs): listen, transpose, rhythms, export MIDI; piano, guitar chord charts or Push pad view. Data built by the Python tools in `tools/progressions/` (Chordonomicon, CC BY-NC 4.0) |

`library.js` keeps what you save (songs, lyrics, MIDI files) in the browser, on this device only.
`common.css` holds the styles shared by the home page, the synth, the generator and
the pad prototype.

## Edit / iterate

- Each part is plain HTML + JS loaded with classic `<script>` tags; the load order at
  the bottom of each `index.html` matters.
- Synth starter sounds: `synth/patches.js`; Focus music moods: `generator/moods.js`.
- After a change, save and refresh the tab.
