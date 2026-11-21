# Drifton — fonctionnalités

Ce que fait chaque outil et ce qui est prévu. Site : https://rooxam.github.io/drifton/

## Listen

### Focus music (`generator/`)
Musique fonctionnelle composée en direct pour se concentrer ou se détendre.
- [x] Cinq instruments du synthé joués par des règles : nappe, basse, piano doux en arpèges (Keys), cloches, texture.
- [x] Harmonie modale (tonalité, mode), accords enchaînés au hasard pondéré et liés en douceur (voice leading), changements calés sur les mesures, tempo réglable.
- [x] Mouvement réglable : arpèges et basse en rythme, ou accords tenus.
- [x] Effets : réverbe, écho calé sur le tempo, chaleur (saturation douce, aigus adoucis), bande (hauteur qui ondule, souffle), pulsation (modulation d'amplitude, 16 Hz pour la concentration).
- [x] Ambiances : Deep focus, Flow, Calm, Night, Hazy (bande usée, accords sus, riff répété ; « Music has the right to drift »), Drone (un accord ouvert tenu, sans rythme ; remplace l'ancien outil Drone), et Auto qui suit l'heure de la journée ; réglages gardés d'une visite à l'autre.
- [x] Les couches (piano, cloches, texture) entrent et sortent en fondu toutes les quelques mesures.
- [x] Visuel abstrait qui bouge avec le son, entre l'espace et Kandinsky : chaque instrument a ses formes (nappe : cercles et planètes ; basse : traits ; texture : volumes en fil de fer qui vibrent ; cloches et piano : lueurs placées selon la note), traînées qui filent, grain de pellicule ; plein écran avec écran gardé allumé.
- [x] Réglages rangés dans des sections dépliantes (ouvertes ou fermées, gardé d'une visite à l'autre).
- [x] Sons réglables sur la page Synth, repris en direct.
- [ ] Ses propres sons : notes isolées et textures (enregistrées dans un logiciel de musique) jouées par le générateur, dans le style d'Endel.
- [ ] Évolution sur une session : dérive lente des paramètres, montée / plateau / descente.
- [ ] Jouer une progression choisie dans Progressions.
- [ ] Apprendre ses goûts : 👍 / 👎 ou « passer », réglages préférés renforcés ; remarques écrites (« trop brillant ») traduites en réglages.
- [ ] Profils focus / détente / sommeil.

## Play & learn

### Piano score (`score/`)
S'entraîner au piano à partir d'un fichier MIDI, pensé pour l'iPad.
- [x] Notes qui tombent vers un clavier, couleur par main ou piste, touches qui s'allument, numéros de mesure.
- [x] Vitesse 20–150 %, boucle sur des mesures, voir / entendre chaque piste, noms des notes.
- [x] Tous les fichiers ouverts gardés sur l'appareil (« My files »).
- [ ] Détection au micro des notes jouées, et mode « attendre la bonne note ».
- [ ] Clavier MIDI branché (ordinateur), métronome, décompte, zoom, 88 touches, vue partition, vue guitare.

### Songbook (`songbook/`)
Des morceaux à jouer à la guitare.
- [x] Morceaux intégrés : accords par partie, capo, accordage, grilles d'accords, chiffres romains, tonalité, transposition.
- [x] Jouer en suivant : tout le morceau ou une partie en boucle ; l'accord joué s'allume, la page défile.
- [x] Ses propres morceaux et paroles, collés depuis un site d'accords : gardés sur l'appareil seulement, vue avec chaque accord au-dessus du bon mot, export / import.
- [ ] Arrangements personnels : positions exactes, durée de chaque accord dans la mesure, rythme de grattage, tempo réel.
- [ ] Défilement continu à vitesse réglable, plein écran.
- [ ] Toucher un accord ouvre sa fiche dans Chords.
- [ ] Importer un morceau depuis la page d'un site d'accords en un geste (raccourci iPhone, favori sur ordinateur).

### Chords (`chords/`)
Un jeu pour apprendre les accords de guitare.
- [x] Une position s'affiche, on choisit son nom parmi 4 ; grille jouable au doigt (toucher une corde, glisser pour gratter), son de corde pincée.
- [x] Indices un par un : cordes à vide, notes, fondamentale, type d'accord.
- [x] Mode à l'oreille, familles d'accords au choix, score, série, record.
- [x] À la réponse : chaque note et son rôle (tonique, tierce, quinte, septième…) sous sa corde.
- [ ] Mode progression : reconnaître les accords quand ils s'enchaînent.
- [ ] Trouver la position : le nom est donné, on pose les doigts.
- [ ] Les accords de mes morceaux (depuis le Songbook).
- [ ] Explorer : n'importe quelle fondamentale et type, sur manche et clavier ; version piano du jeu.

## Make

### Chord progressions (`progressions/`)
Des progressions typiques d'un style, trouvées dans 680 000 morceaux.
- [x] 17 styles, ~410 progressions ; écouter (piano ou pad du synthé), tonique, tempo, rythmes, version simple ou « comme dans le style ».
- [x] Vues piano, guitare (positions jouables) et Push (grille 8×8).
- [x] Export MIDI (piste accords + piste basse), morceaux d'exemple.
- [ ] Envoyer à Focus music, voicings au choix, favoris, filtre par longueur, mode « In Key » du Push.
- [ ] Analyser les accords de ses propres fichiers MIDI (tonalité, mode, chiffres romains) et les ajouter à sa bibliothèque.

Données : [Chordonomicon](https://huggingface.co/datasets/ailsntua/Chordonomicon) (CC BY-NC 4.0), analysées par les scripts de `tools/progressions/`.

### Synth (`synth/`)
- [x] Voix : 2 oscillateurs avec unisson, bruit, filtre, enveloppes, polyphonie, clavier, oscilloscope et spectre.
- [x] Modulation : 2 LFO (dont Drift et S&H), matrice de modulation.
- [x] Sons sauvegardés et partagés avec Focus music, export / import.
- [x] Effets partagés (`effects.js`) : réverbe, écho, chaleur, bande, pulsation (utilisés par Focus music).
- [ ] Effets réglables par instrument sur la page Synth, chorus.
- [x] Cinquième instrument : Keys (piano doux).

## Lab

### Pad states (`pads/`)
- [x] Prototype : fondu entre trois états d'une nappe audio, conducteur, couche granulaire.

## Partout
- [x] Fonctionne sur iPhone / iPad (son malgré le bouton silencieux).
- [x] Bibliothèque sur l'appareil (morceaux, paroles, MIDI), export / import.
- [ ] Application installable sur l'écran d'accueil, utilisable hors ligne.
- [ ] Synchronisation de la bibliothèque entre appareils.
