#!/bin/bash
# Lanceur macOS — double-cliquez sur ce fichier dans le Finder
cd "$(dirname "$0")"

# Cherche Python
PYTHON=""
for p in python3 python; do
    if command -v "$p" &>/dev/null; then PYTHON="$p"; break; fi
done

if [ -z "$PYTHON" ]; then
    osascript -e 'display alert "Python introuvable" message "Installez Python depuis https://www.python.org" as critical'
    exit 1
fi

# Installe Flask si besoin
$PYTHON -c "import flask" 2>/dev/null || $PYTHON -m pip install flask --quiet

# Ouvre le navigateur après 1.5s
sleep 1.5 && open "http://localhost:5000" &

echo "🏰  Tile Builder 3D Builder — http://localhost:5000"
$PYTHON app.py
