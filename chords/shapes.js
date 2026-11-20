// The chord shapes of the game: classic guitar fingerings, written by hand.
// Frets from the low E string to the high E string; "x" = not played, 0 = open string.
// Families can be chosen in the game: open chords first, then sevenths, barre chords…

const FAMILIES = [
  { id: "open", label: "Open chords" },
  { id: "seventh", label: "Sevenths" },
  { id: "barre", label: "Barre chords" },
  { id: "colour", label: "Sus · add · slash" },
];

const SHAPES = [
  // Open major and minor chords: the first ones everybody learns.
  ["C", "x32010", "open"], ["D", "xx0232", "open"], ["E", "022100", "open"],
  ["G", "320003", "open"], ["A", "x02220", "open"], ["Am", "x02210", "open"],
  ["Em", "022000", "open"], ["Dm", "xx0231", "open"],
  // Sevenths: dominant 7, minor 7, major 7.
  ["A7", "x02020", "seventh"], ["D7", "xx0212", "seventh"], ["E7", "020100", "seventh"],
  ["G7", "320001", "seventh"], ["B7", "x21202", "seventh"], ["C7", "x32310", "seventh"],
  ["Am7", "x02010", "seventh"], ["Em7", "020000", "seventh"], ["Dm7", "xx0211", "seventh"],
  ["Cmaj7", "x32000", "seventh"], ["Fmaj7", "xx3210", "seventh"], ["Amaj7", "x02120", "seventh"],
  ["Dmaj7", "xx0222", "seventh"],
  // Barre chords: one finger across the strings, the shape moves along the neck.
  ["F", "133211", "barre"], ["Bm", "x24432", "barre"], ["F#m", "244222", "barre"],
  ["Bb", "x13331", "barre"], ["B", "x24442", "barre"], ["C#m", "x46654", "barre"],
  ["Gm", "355333", "barre"], ["Cm", "x35543", "barre"], ["Fm", "133111", "barre"],
  ["Ab", "466544", "barre"],
  // Colours: suspended (no third), added ninth, a different bass note.
  ["Dsus2", "xx0230", "colour"], ["Dsus4", "xx0233", "colour"], ["Asus2", "x02200", "colour"],
  ["Asus4", "x02230", "colour"], ["Esus4", "022200", "colour"], ["Cadd9", "x32030", "colour"],
  ["G/B", "x20003", "colour"], ["D/F#", "200232", "colour"],
].map(([name, frets, family]) => ({
  name,
  family,
  frets: [...frets].map((c) => (c === "x" ? -1 : Number(c))),
}));

// What kind of chord: used by a hint and to pick tricky wrong answers.
function chordKind(name) {
  if (name.includes("/")) return "a major chord with another note in the bass";
  if (/sus/.test(name)) return "a suspended chord (no third)";
  if (/add9/.test(name)) return "a major chord with an added ninth";
  if (/maj7/.test(name)) return "a major seventh chord";
  if (/m7/.test(name)) return "a minor seventh chord";
  if (/7/.test(name)) return "a seventh chord (dominant)";
  if (/m/.test(name)) return "a minor chord";
  return "a major chord";
}
