# Pandora 2026

**Système de scoring temps réel pour jeu d'animation à buzzers physiques.**

App Electron qui projette les scores sur grand écran (1920×1080), pilotée par une télécommande mobile/écran fixe et alimentée par des capteurs physiques externes via OSC. Charte LUMIIA. Compatible Chataigne / QLab / Resolume / Ableton.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  BUZZERS PHYSIQUES (Arduino / MaKey MaKey / autre)                      │
│  ──► OSC /Touch <playerNum> sur UDP:3333                                │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  ▼
                         ┌────────────────┐               OSC OUT
                         │   main.js      │  ──/pandora/*──► RÉGIE
                         │   Electron     │     UDP:7000    (Chataigne / QLab...)
                         └─┬───────────┬──┘
              IPC          │           │     WebSocket :8080
                           ▼           ▼
                  ┌─────────────┐  ┌─────────────────────┐
                  │ index.html  │  │ remote.html         │
                  │ Projection  │  │ Télécommande        │
                  │ 1920×1080   │  │ 1920×1080 paysage   │
                  └─────────────┘  └─────────────────────┘
```

**Quatre flux convergent dans `main.js` :**

1. **OSC entrant** (UDP 3333) — capteur physique envoie `/Touch <N>` → joueur N marque 1 point
2. **WebSocket bidirectionnel** (8080) — télécommande configure et contrôle
3. **IPC Electron** — projection ↔ process principal
4. **OSC sortant** (UDP, défaut `127.0.0.1:7000`, configurable depuis remote) — events du jeu vers la régie

---

## Modes de jeu

| Mode | Fin de partie | Affichage central |
|------|---------------|-------------------|
| **Timer** | Décompte → 0 | `MM:SS` qui descend + anneau de progression |
| **Course** | Premier à N points (10/20/50) | `<max> / <cible>` + anneau ratio |
| **Mort subite** | Décompte → 0, puis si égalité au max → prolongation jusqu'au prochain point | `MM:SS` puis `∞` |

---

## Stack

| Composant     | Version | Rôle                                |
|---------------|---------|-------------------------------------|
| Electron      | ^28.0   | App desktop (fenêtre 1920×1080)     |
| node-osc      | ^2.1    | Serveur + client OSC UDP            |
| ws            | ^8.16   | Serveur WebSocket                   |

Vanilla JS pur. Pas de framework, pas de build step. Sons générés via Web Audio API (aucun asset audio).

---

## Installation

```bash
git clone https://github.com/I-immersion/game-pandora.git
cd game-pandora
npm install
```

Prérequis : Node.js ≥ 18, npm.

---

## Lancement

### Méthode rapide (recommandée)

Double-clic sur **`Lancer Pandora.command`** à la racine du projet. Une fenêtre Terminal s'ouvre, lance Electron, la projection apparaît.

### Méthode manuelle

```bash
npm start
```

L'app expose :
- **WebSocket** `ws://<IP_Mac>:8080` ← télécommande
- **OSC entrant** `udp://<IP_Mac>:3333` ← buzzers
- **OSC sortant** `udp://127.0.0.1:7000` → régie (configurable depuis remote)

---

## Télécommande

Ouvrir `remote.html` dans un navigateur (Safari/Chrome) sur n'importe quel appareil du même réseau WiFi que le Mac. **Interface paysage 1920×1080** : optimisée pour iPad horizontal, tablette ou écran fixe dédié.

### Layout (3 colonnes, no scroll)

| Colonne gauche | Colonne centre | Colonne droite |
|---------------|-----------------|----------------|
| Mode (3 boutons) | Anneau de progression coloré (vert→jaune→rouge) | Grille 3×2 des scores |
| Joueurs (1-6) | Timer central `MM:SS` | Bouton "−" par joueur (annulation) |
| Durée / Objectif | Bouton DÉMARRER géant | |
| Noms en grille 2×3 | Bouton Réinitialiser | |

Boutons en header : badge connexion (cliquable → IP du Mac), bouton ⚙ Régie OSC (cliquable → host/port OSC sortant).

Préférences persistées en `localStorage` : mode, joueurs, noms, durée, cible.

---

## OSC entrant (buzzers → Pandora)

Le device physique envoie en OSC UDP vers le Mac :

- **Port** : `3333`
- **Adresse** : `/Touch`
- **Argument** : entier joueur (1 à 6)

### Exemples par device

**Arduino + WiFi/Ethernet shield :**
```cpp
OSCMessage msg("/Touch");
msg.add(1);
Udp.beginPacket(macIP, 3333);
msg.send(Udp);
Udp.endPacket();
```

**MaKey MaKey + Processing :**
```processing
OscMessage msg = new OscMessage("/Touch");
msg.add(playerNum);
oscP5.send(msg, new NetAddress("192.168.1.X", 3333));
```

**Test depuis Mac :**
```bash
brew install liblo
oscsend localhost 3333 /Touch i 1
```

---

## OSC sortant (Pandora → Chataigne / régie)

Configurable host + port depuis la télécommande (bouton ⚙ Régie OSC). Défaut `127.0.0.1:7000`.

### Namespace complet

#### Game events (triggers)
| Adresse | Args | Émis quand |
|---------|------|-----------|
| `/pandora/game/started` | — | Partie démarrée |
| `/pandora/game/stopped` | — | Arrêt manuel |
| `/pandora/game/finished` | — | Fin naturelle |
| `/pandora/game/reset` | — | Reset scores |

#### Timer (continu, émis chaque seconde pendant la partie)
| Adresse | Args | Description |
|---------|------|-------------|
| `/pandora/timer/remaining` | `<int>` | Secondes restantes |
| `/pandora/timer/elapsed` | `<int>` | Secondes écoulées |
| `/pandora/timer/percent` | `<float>` | Ratio 0.0 → 1.0 (idéal fader lumière) |
| `/pandora/timer/warning` | — | Trigger à l'entrée des 60s puis 30s |
| `/pandora/timer/danger` | — | Trigger à l'entrée des 10s |

#### Score par joueur (granulaire)
| Adresse | Args | Émis quand |
|---------|------|-----------|
| `/pandora/score/<N>/value` | `<int>` | À chaque changement de score |
| `/pandora/score/<N>/added` | `<int>` | À chaque +1 (arg = nouveau score) |
| `/pandora/score/<N>/removed` | `<int>` | À chaque annulation |

`<N>` = 1 à 6.

#### Leader / Winner
| Adresse | Args | Description |
|---------|------|-------------|
| `/pandora/leader` | `<int>` | Qui est en tête (0 si égalité ou aucun) |
| `/pandora/winner/<N>` | — | Un trigger par gagnant à la fin |
| `/pandora/winner/count` | `<int>` | Nombre de gagnants (1 si pas d'égalité) |

#### Config (broadcast à chaque changement)
| Adresse | Args |
|---------|------|
| `/pandora/state` | `<string>` (idle/playing/stopped/finished/suddendeath) |
| `/pandora/mode` | `<string>` (timer/race/suddendeath) |
| `/pandora/players` | `<int>` |
| `/pandora/duration` | `<int>` (minutes) |
| `/pandora/target` | `<int>` (points, race uniquement) |

#### Sudden death
| Adresse | Args | Description |
|---------|------|-------------|
| `/pandora/suddendeath/enter` | — | Trigger à l'entrée en prolongation |

### Exemples Chataigne

Dans un module OSC Chataigne, créer ces paramètres et les mapper :
- `timerPercent` (float 0-1) sur `/pandora/timer/percent` → mapper en fader lumière ambient → tendu
- `leader` (int 0-6) sur `/pandora/leader` → switch lumière spot couleur joueur
- `score1.added` (int) sur `/pandora/score/1/added` → déclenche une cue flash quand J1 marque
- Trigger `/pandora/winner/1` → lance la séquence "victoire J1"
- Trigger `/pandora/timer/danger` → switch ambiance globale en rouge dramatique

---

## Protocole WebSocket (référence dev)

### Messages remote → main.js

```js
{ type: 'set_mode',     mode: 'timer' | 'race' | 'suddendeath' }
{ type: 'set_players',  count: 1..6 }
{ type: 'set_duration', minutes: 10|20|30 }
{ type: 'set_target',   target: 10|20|50 }
{ type: 'set_names',    names: ['Alice', ...] }
{ type: 'set_osc_out',  host: '192.168.1.20', port: 7000 }
{ type: 'start_game' }
{ type: 'stop_game' }
{ type: 'reset_game' }
{ type: 'undo_point',   player: 1..6 }
{ type: 'get_scores' }
```

### Messages main.js → remote

```js
{ type: 'info',            message: '...' }
{ type: 'config',          mode, players, duration, target, names }
{ type: 'game_state',      state, remaining, total }    // total = durée totale en sec
{ type: 'scores',          scores: [{ player, score }, ...] }
{ type: 'osc_out_config',  host, port }
{ type: 'osc',             address, args }
```

À chaque nouvelle connexion WS : config + game_state + scores + osc_out_config envoyés au client.

---

## Charte graphique LUMIIA

**Fond & texte (sombre) :**
- `--bg: #0d0d0f` · `--bg2: #141417` · `--bg3: #1c1c21`
- `--text: #f0f0f2` · `--text2: #888890` · `--text3: #555560`
- `--border: rgba(255,255,255,0.07)`

**Couleurs joueurs (catégorielles LUMIIA) :**

| Joueur | Couleur | Hex |
|--------|---------|-----|
| 1 | Orange (lumiia) | `#ff6b35` |
| 2 | Jaune (admin) | `#fbbf24` |
| 3 | Vert lime (perso) | `#4ade80` |
| 4 | Cyan (signal) | `#00e5ff` |
| 5 | Violet (raffinés) | `#c084fc` |
| 6 | Rouge (urgent) | `#f43f5e` |

**États système :**
- Playing `#4ade80` · Warning `#fbbf24` · Danger `#f43f5e` · Info `#00e5ff`

---

## Sons (Web Audio API procéduraux)

| Event | Son |
|-------|-----|
| Point marqué | Tick court, fréquence unique par joueur (540 → 990 Hz) |
| Point annulé | Tone descendant sawtooth |
| Démarrage partie | Sweep 220→660 Hz + impact 880 Hz |
| Arrêt manuel | Tone descendant 330→110 Hz |
| Fin de partie | Gong 110/220/330 Hz sustainés 1.2 s |
| Warning 60s / 30s | Bi-tone 880→660 Hz |
| Countdown dernier 10s | Bip par seconde, plus aigu sur les 3 derniers |
| Mort subite | Descente sawtooth + descente square |

---

## Structure du repo

```
game-pandora/
├── main.js               # Process Electron (bridge OSC ↔ WS + OSC out)
├── index.html            # Projection 1920×1080
├── remote.html           # Télécommande 1920×1080 paysage
├── Lancer Pandora.command # Lanceur double-clic macOS
├── package.json
├── package-lock.json
└── README.md
```

---

## Limitations connues

- **Pas d'authentification WebSocket** — réseau partagé = exposé. À sécuriser si besoin.
- **Pas de persistance partie en cours** — un crash perd la partie.
- **Connexion remote sans auto-discovery** — saisir l'IP du Mac à la main.
- **`nodeIntegration: true` + `contextIsolation: false`** — dette technique Electron.

---

## Roadmap

- [x] Modes de jeu (Timer / Course / Mort subite)
- [x] Sons procéduraux Web Audio API
- [x] Annulation de point
- [x] OSC sortant enrichi pour Chataigne (namespace granulaire `/pandora/*`)
- [x] Charte LUMIIA
- [x] Remote 1920×1080 paysage avec anneau de progression
- [x] Persistance config remote (localStorage)
- [x] Lanceur `.command` macOS
- [ ] Connexion device physique (Arduino / MaKey MaKey)
- [ ] Mode démo (simulateur OSC sans matériel)
- [ ] Replay JSON post-partie
- [ ] Auto-discovery mDNS (`pandora.local`)
- [ ] Mode équipes (2v2, 3v3)
- [ ] Migration Electron contextIsolation
- [ ] Build `.app` standalone pour distribution finale

---

## Licence

MIT
