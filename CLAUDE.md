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
  (`progressions/`, `synth/`), Lab (`pads/`). Atelier Python hors ligne dans `tools/`
  (bibliothèque standard seulement ; données brutes dans `tools/data/`, ignoré par git). Une illustration SVG par outil, en nuances du violet du site. Styles partagés dans `common.css`, bibliothèque locale partagée dans
  `library.js` (IndexedDB, sur l'appareil seulement).
- Toute page crée son `AudioContext` avec `createAudio()` (`audio.js`, chargé en premier) :
  mode « lecture » d'iOS (bouton silencieux), réveil du son sur les bons gestes (fin du
  toucher, clic), reprise au retour sur l'onglet.
- Jamais de paroles de chansons dans le dépôt (public, droit d'auteur) : accords et
  sections seulement ; les paroles restent sur l'appareil de l'utilisateur.
- Ne commiter que sur demande.

## Plan du code

Un fichier = une brique ; l'ordre des `<script>` en bas de chaque `index.html` compte.

| Chemin | Contenu |
|---|---|
| `index.html`, `common.css` | accueil (une carte + illustration SVG par outil), styles partagés |
| `fonts/` | Bricolage Grotesque (titres) et Figtree (texte), hébergées ici (hors ligne, sans service tiers), licences OFL |
| `audio.js` | `createAudio()` : AudioContext réglé pour iPhone / iPad |
| `library.js` | bibliothèque sur l'appareil (IndexedDB) : morceaux, paroles, MIDI ; export / import |
| `synth/` | synthé : `util`, `params` (liste des paramètres → UI), `envelope`, `lfo`, `osc` (unisson), `voice`, `synth` (`Synth`, `MasterBus`), `effects` (`FxBus` : réverbe, écho, chaleur, bande, pulsation), `storage` (sons sauvegardés), `patches`, `keyboard`, `scope`, `main` |
| `generator/` | Focus music : `harmony` (modes, accords, Markov, voice leading), `generator` (rôles, grille de mesures, arpèges, conducteur des couches), `moods` (ambiances, Auto selon l'heure), `visual` (visuel abstrait qui suit le son), `main` ; réutilise `synth/` |
| `player/` | redirection vers Focus music, ambiance Drone (ancienne adresse) |
| `pads/` | Pad states (prototype) |
| `score/` | Piano score : `midi` (lecteur MIDI), `piano` (son), `player` (transport, boucle), `roll` (notes qui tombent), `timeline`, `demo`, `main` |
| `progressions/` | `data.js` (généré par `tools/progressions/`), `theory` (chiffres romains → accords, voicings), `player` (boucle, rythmes, `chordEvents`), `sound` (piano ou pad), `midiwrite`, `keys`, `guitar` (positions + grilles), `push`, `main` |
| `songbook/` | `songs.js` (accords seulement), `chordsym` (symboles d'accords, transposition, tonalité), `sheet` (fiche collée → accords + paroles), `main` ; réutilise `progressions/` |
| `chords/` | `shapes` (positions écrites à la main), `pluck` (corde Karplus-Strong), `neck` (grille jouable), `main` (jeu) |
| `tools/progressions/` | Python, bibliothèque standard : `chords`, `key`, `styles`, `analyze` (Chordonomicon → `progressions/data.js`) |
