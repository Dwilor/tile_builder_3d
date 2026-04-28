@echo off
cd /d "%~dp0"

:: ─── Cherche Python ─────────────────────────────────────────────
set PYTHON=
for %%P in (python python3 py) do (
    if not defined PYTHON (
        %%P --version >nul 2>&1 && set PYTHON=%%P
    )
)

if not defined PYTHON (
    echo.
    echo  ERREUR : Python n'est pas installe ou pas dans le PATH.
    echo  Telechargez Python sur https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

:: ─── Installe les dependances si besoin ─────────────────────────
%PYTHON% -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo  Installation de Flask...
    %PYTHON% -m pip install flask --quiet
)

:: ─── Lance le serveur ────────────────────────────────────────────
echo  Lancement de Tile Builder 3D Builder...
start "" "http://localhost:5000"
%PYTHON% app.py
