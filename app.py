import os, re, shutil, signal, sys, atexit, threading, time
from pathlib import Path
from flask import Flask, jsonify, send_from_directory, request, render_template

app = Flask(__name__)

BASE_DIR = Path(__file__).parent
STL_DIR  = Path(os.environ.get("STL_DIR", BASE_DIR / "stl"))

CATEGORY_RULES = [
    ("Élévation & Escaliers", ["Elevation","Stairs","Levels","HalfStreet","Ramp","Step"]),
    ("Extérieur",             ["Street","FullSteet","CornerStreet","DamagedWall","Exterior","Facade"]),
    ("Murs & Ouvertures",     ["Wall","Door","Window","Arch","Corner","Pillar","Column","Gate"]),
    ("Sols",                  ["Floor","Hatch","Tile","Ground","Paving"]),
    ("Mobilier",              ["Table","Bar","Shelf","Bookshelf","Desk","Crates","Bed","Sofa","Bathroom","Chair","Bench","Cabinet","Wardrobe"]),
    ("Accessoires & Props",   ["Barrel","Display","Cauldron","Oven","Lamp","FirePlace","Torch","Chest","Crate","Pot","Jug","Sign","Candle"]),
    ("Toit & Plafond",        ["Roof","Ceiling","Beam","Rafter","Chimney"]),
    ("Nature",                ["Tree","Bush","Rock","Stone","Fountain","Well","Garden"]),
]

def categorise(stem, parent=None):
    if parent and parent.lower() not in ("stl", ".", ""):
        return parent.replace("_"," ").replace("-"," ").strip()
    for cat, kws in CATEGORY_RULES:
        if any(k.lower() in stem.lower() for k in kws):
            return cat
    return "Divers"

def clean_label(stem):
    s = re.sub(r'^[A-Z]{2,5}_\d+_', '', stem)
    s = re.sub(r'^[A-Z]{2,5}_', '', s)
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', s)
    s = s.replace('_',' ').replace('-',' ')
    return re.sub(r'\s+', ' ', s).strip() or stem

def safe_path(rel):
    """Résout un chemin relatif sous STL_DIR et vérifie qu'il ne sort pas."""
    target = (STL_DIR / rel).resolve()
    if not str(target).startswith(str(STL_DIR.resolve())):
        return None
    return target

@app.route("/api/heartbeat", methods=["POST"])
def heartbeat():
    """Le navigateur envoie un ping toutes les 5s. Si on n'en reçoit plus,
    le watchdog éteint le serveur après 15s."""
    _last_heartbeat[0] = time.time()
    return jsonify({"ok": True})

@app.route("/api/shutdown", methods=["POST"])
def shutdown():
    """Arrêt explicite (optionnel, utilisé par le bouton fermer de la page)."""
    _shutdown()
    return jsonify({"ok": True})

# ── Routes principales ────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/tiles")
def list_tiles():
    STL_DIR.mkdir(parents=True, exist_ok=True)
    tiles, seen = [], set()
    for f in sorted(STL_DIR.rglob("*.stl")):
        if "hollow" in f.name.lower() or f.stem in seen:
            continue
        seen.add(f.stem)
        parent = f.parent.name if f.parent != STL_DIR else None
        rel = f.relative_to(STL_DIR)
        tiles.append({
            "id":       f.stem,
            "label":    clean_label(f.stem),
            "filename": str(rel).replace("\\", "/"),
            "category": categorise(f.stem, parent),
        })
    return jsonify(tiles)

@app.route("/stl/<path:filename>")
def serve_stl(filename):
    return send_from_directory(STL_DIR, filename)

# ── API Bibliothèque ──────────────────────────────────────────────────────────

@app.route("/api/library")
def get_library():
    """Retourne la structure complète : dossiers + fichiers."""
    STL_DIR.mkdir(parents=True, exist_ok=True)
    folders = {}
    for f in sorted(STL_DIR.rglob("*.stl")):
        if "hollow" in f.name.lower():
            continue
        parent = f.parent.name if f.parent != STL_DIR else "__root__"
        folders.setdefault(parent, []).append({
            "stem":     f.stem,
            "filename": str(f.relative_to(STL_DIR)).replace("\\", "/"),
            "label":    clean_label(f.stem),
        })
    # Liste des dossiers (y compris dossiers vides)
    dir_names = [d.name for d in sorted(STL_DIR.iterdir()) if d.is_dir()]
    return jsonify({"folders": dir_names, "files": folders})

@app.route("/api/folder", methods=["POST"])
def create_folder():
    name = request.json.get("name","").strip()
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return jsonify({"error": "Nom invalide"}), 400
    target = STL_DIR / name
    if target.exists():
        return jsonify({"error": "Ce dossier existe déjà"}), 409
    target.mkdir(parents=True)
    return jsonify({"ok": True})

@app.route("/api/folder/<path:name>", methods=["DELETE"])
def delete_folder(name):
    target = safe_path(name)
    if not target or not target.is_dir():
        return jsonify({"error": "Dossier introuvable"}), 404
    shutil.rmtree(target)
    return jsonify({"ok": True})

@app.route("/api/upload/<path:folder>", methods=["POST"])
def upload_stl(folder):
    """Upload un ou plusieurs STL dans un dossier (ou __root__ pour la racine)."""
    if folder == "__root__":
        dest_dir = STL_DIR
    else:
        dest_dir = safe_path(folder)
        if not dest_dir or not dest_dir.is_dir():
            return jsonify({"error": "Dossier introuvable"}), 404
    saved = []
    for f in request.files.getlist("files"):
        if not f.filename.lower().endswith(".stl"):
            continue
        fname = Path(f.filename).name  # sécurité : pas de traversal
        dest = dest_dir / fname
        f.save(dest)
        saved.append(fname)
    return jsonify({"ok": True, "saved": saved})

@app.route("/api/stl/<path:filepath>", methods=["DELETE"])
def delete_stl(filepath):
    target = safe_path(filepath)
    if not target or not target.is_file():
        return jsonify({"error": "Fichier introuvable"}), 404
    target.unlink()
    return jsonify({"ok": True})

# ── Heartbeat watchdog ────────────────────────────────────────────────────────
# Stocke le timestamp du dernier heartbeat reçu du navigateur.
_last_heartbeat = [0.0]
_HEARTBEAT_TIMEOUT = 20  # secondes avant auto-shutdown

def _watchdog():
    """Thread daemon : éteint Flask si le navigateur ne répond plus."""
    # Attend d'abord qu'au moins un heartbeat ait été reçu
    # (évite de s'arrêter avant que la page soit ouverte)
    while _last_heartbeat[0] == 0.0:
        time.sleep(1)
    while True:
        time.sleep(5)
        if time.time() - _last_heartbeat[0] > _HEARTBEAT_TIMEOUT:
            print("\n  Navigateur fermé — arrêt du serveur.\n")
            _shutdown()

def _shutdown(signum=None, frame=None):
    """Arrêt propre : libère le port et termine le processus."""
    sys.exit(0)

# Gestion des signaux pour fermeture propre (évite le processus zombi dans le gestionnaire des tâches)
signal.signal(signal.SIGINT,  _shutdown)
signal.signal(signal.SIGTERM, _shutdown)
# Sur Windows, SIGBREAK est envoyé quand la console est fermée
if hasattr(signal, 'SIGBREAK'):
    signal.signal(signal.SIGBREAK, _shutdown)

atexit.register(lambda: None)  # S'assure que atexit est bien exécuté

if __name__ == "__main__":
    print(f"\n  ⚔  Tile Builder 3D")
    print(f"  Dossier STL : {STL_DIR}")
    count = len(list(STL_DIR.rglob("*.stl"))) if STL_DIR.exists() else 0
    print(f"  {count} fichier(s) STL  —  http://localhost:5000\n")
    try:
        t = threading.Thread(target=_watchdog, daemon=True)
        t.start()
        app.run(debug=False, port=5000, use_reloader=False)
    except (KeyboardInterrupt, SystemExit):
        pass
