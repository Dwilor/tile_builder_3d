# 🏰 Tavern Tiles Builder

Constructeur de carte 3D isométrique pour jeux de rôle fantasy.  
Interface web locale alimentée par Flask + Three.js.

---

## Lancement (sans ligne de commande)

### Windows
Double-cliquez sur **`Lancer Tavern Tiles.vbs`**
→ Le navigateur s'ouvre automatiquement sur `http://localhost:5000`
→ Aucune fenêtre noire visible

> Si vous préférez voir les logs, utilisez `Lancer Tavern Tiles.bat` à la place.

### macOS
Double-cliquez sur **`Lancer Tavern Tiles.command`**  
(La première fois, faites Clic droit → Ouvrir pour contourner Gatekeeper)

---

## Organisation des fichiers STL

Placez vos modèles dans le dossier **`stl/`** à côté de ce script.

### Option A — Dossier plat
```
stl/
  TWN_001_FloorBasic.stl
  TWN_042_WallCornerArch.stl
  ...
```
Les catégories sont détectées automatiquement à partir des mots-clés dans le nom du fichier.

### Option B — Sous-dossiers (recommandé)
```
stl/
  Sols/
    floor_basic.stl
    floor_damaged.stl
  Murs & Ouvertures/
    wall_straight.stl
    door_arch.stl
  Mobilier/
    table_round.stl
    barrel.stl
```
Le nom du sous-dossier devient directement la catégorie — prioritaire sur la détection par mots-clés.

### Mélange des deux
Les deux approches sont compatibles. Vous pouvez avoir un dossier `Mobilier/` organisé manuellement et des STL en vrac à la racine de `stl/` qui seront catégorisés automatiquement.

---

## Dossier STL personnalisé

Pour pointer vers un autre dossier (ex: votre collection existante) :

**Windows** — modifiez `Lancer Tavern Tiles.bat` et ajoutez avant le lancement :
```bat
set STL_DIR=D:\3D PRINT\MODELES\JDR\TAVERN\DxT Medieval Town Set
```

**macOS/Linux** :
```bash
STL_DIR="/chemin/vers/mes/stl" python3 app.py
```

---

## Contrôles

| Action | Contrôle |
|---|---|
| Placer une tuile | Clic gauche |
| Orbite caméra | Clic droit + glisser |
| Zoom | Molette |
| Déplacement | Z Q S D |
| Rotation tuile | R |
| Annuler | Ctrl+Z |
| Rétablir | Ctrl+Y |
| Changer de niveau | ↑ ↓ ou boutons |

---

## Prérequis

- Python 3.8+
- Flask (installé automatiquement par les lanceurs)
