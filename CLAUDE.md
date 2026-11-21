# Drifton

Deux roadmaps :
- **la roadmap privée** (vision, décisions, priorités, apprentissage, hébergement, journal)
  est un doc claude.ai, « Drifton — roadmap » (lien dans la mémoire de Claude). La lire en
  début de session et la mettre à jour (journal, priorités, décisions) via le connecteur
  Claude Docs ;
- **`ROADMAP.md`** (dépôt public) ne liste que les fonctionnalités de l'app, outil par
  outil : rien sur l'apprentissage, l'infra ou la façon de travailler. Cocher / ajouter
  quand une fonctionnalité est livrée ou prévue.

## Conventions

- Parler en français avec l'utilisateur. Code, commentaires, UI et messages de commit en anglais.
- Code court, commenté, un fichier par brique.
- Zéro dépendance, Web Audio natif. Tout doit marcher en double-cliquant le HTML
  (`file://`) : pas de modules ES ni de `fetch`, des `<script>` classiques dans l'ordre.
  Les liens vers une page pointent sur `dossier/index.html`, jamais sur `dossier/`
  (en `file://`, un lien vers un dossier affiche la liste des fichiers).
- Tout le projet est Drifton : une **collection de petits outils autour du son**, cohérents
  (même moteur, même design), chacun utilisable seul avec sa propre adresse.
  `index.html` (racine) est l'accueil, rangé par intention : Listen (`generator/` = « Focus
  music », dont l'ambiance Drone ; `player/` ne fait que rediriger vers elle), Play & learn (`score/`, `songbook/`, `chords/`), Make
  (`progressions/`, `sketch/`, `synth/`), Lab (`pads/`). Atelier Python hors ligne dans `tools/`
  (bibliothèque standard seulement ; données brutes dans `tools/data/`, ignoré par git). Une illustration SVG par outil, en nuances du violet du site. Styles partagés dans `common.css`, bibliothèque locale partagée dans
  `library.js` (IndexedDB, sur l'appareil seulement).
- Toute page crée son `AudioContext` avec `createAudio()` (`audio.js`, chargé en premier) :
  mode « lecture » d'iOS (bouton silencieux), réveil du son sur les bons gestes (fin du
  toucher, clic), reprise au retour sur l'onglet.
- Jamais de paroles de chansons dans le dépôt (public, droit d'auteur) : accords et
  sections seulement ; les paroles restent sur l'appareil de l'utilisateur.
- Commiter et pousser sans demander une fois le travail fini et testé (message en anglais) ;
  demander avant toute réécriture d'historique (squash, force push).

## Documentation technique

`docs/` explique le fonctionnement (algorithmes, chemin du son, données) avec des schémas
Mermaid, en deux langues avec les mêmes pages : `docs/fr/` et `docs/en/`. Quand un
algorithme, un format de données ou une clé de stockage change, mettre à jour la page
concernée dans les deux langues, dans le même commit.

## Plan du code

Un fichier = une brique ; l'ordre des `<script>` en bas de chaque `index.html` compte.

| Chemin | Contenu |
|---|---|
| `index.html`, `common.css` | accueil (une carte + illustration SVG par outil), styles partagés |
| `fonts/` | Bricolage Grotesque (titres) et Figtree (texte), hébergées ici (hors ligne, sans service tiers), licences OFL |
| `audio.js` | `createAudio()` : AudioContext réglé pour iPhone / iPad |
| `library.js` | bibliothèque sur l'appareil (IndexedDB) : morceaux, paroles, MIDI ; export / import |
| `synth/` | synthé : `util`, `params` (liste des paramètres → UI), `envelope`, `lfo`, `osc` (unisson), `voice`, `synth` (`Synth`, `MasterBus`), `effects` (`FxBus` : réverbe, écho, chaleur, bande, pulsation ; `Chorus` ; envois par instrument), `storage` (sons sauvegardés), `patches`, `keyboard`, `scope`, `main` |
| `generator/` | Focus music : `harmony` (modes, accords, Markov, voice leading), `generator` (rôles, grille de mesures, arpèges, conducteur des couches), `moods` (ambiances, Auto selon l'heure), `session` (arc de session, dérive lente, filtres qui respirent), `taste` (bandit 👍 / 👎 par ambiance), `visual` (visuel abstrait qui suit le son), `main` ; réutilise `synth/` et `progressions/theory` (`?prog=`) |
| `player/` | redirection vers Focus music, ambiance Drone (ancienne adresse) |
| `pads/` | Pad states (prototype) |
| `score/` | Piano score : `midi` (lecteur MIDI), `piano` (son), `player` (transport, boucle, décompte), `metronome`, `roll` (notes qui tombent), `neck` (vue guitare), `timeline`, `demo`, `main` |
| `progressions/` | `data.js` (généré par `tools/progressions/`), `theory` (chiffres romains → accords, voicings), `voicing` (serré, ouvert, drop 2, shell), `analyze` (tonalité et accords d'un MIDI), `player` (boucle, rythmes, `chordEvents`), `sound` (piano ou pad), `midiwrite`, `keys`, `guitar` (positions + grilles), `push`, `main` |
| `songbook/` | `songs.js` (accords seulement), `chordsym` (symboles d'accords, transposition, tonalité), `sheet` (fiche collée → accords + paroles), `arrange` (format de mes arrangements), `strum` (son de guitare, grattage, `SheetPlayer`), `popover` (fiche d'un accord), `reader` (défilement, plein écran), `main` ; réutilise `progressions/`, `chords/pluck` |
| `chords/` | `shapes` (positions écrites à la main), `positions` (noms, rôles, positions sur le manche), `pluck` (corde Karplus-Strong), `neck` (grille jouable), `keys` (clavier), `mysongs` (accords de mes morceaux), `place`, `progression`, `explore` (modes), `main` (jeu, onglets) |
| `sketch/` | séquenceur de clips : `song` (modèle, sauvegarde), `drums` (batterie de synthèse), `sound`, `transport` (planificateur, lancement à la mesure), `progression` (chiffres romains ↔ clips), `demo`, `midiexport`, `grid` (scènes), `editor` (pas à pas, piano roll), `pads` (jeu, enregistrement, capture), `main` |
| `tools/progressions/` | Python, bibliothèque standard : `chords`, `key`, `styles`, `analyze` (Chordonomicon → `progressions/data.js`) |
