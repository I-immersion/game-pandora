#!/bin/bash

# ─── Lanceur Pandora 2026 ─────────────────────────────────────────────────
# Double-cliquer ce fichier dans le Finder pour lancer le jeu.

cd "/Users/emmanuelexbrayat/Dropbox/DB LUMIIA 2025/Outils APP Claude/Game Pandora2026"

# Installer les dépendances si node_modules manque OU si qrcode (ajouté en v1.3) manque
if [ ! -d "node_modules" ] || [ ! -d "node_modules/qrcode" ]; then
    echo "🔧 Installation des dépendances (peut prendre 1-2 min)..."
    npm install
    echo ""
fi

echo "🎯 Lancement de Pandora 2026..."
echo "   (Pour arrêter : ferme la fenêtre du jeu, puis Cmd+W ici)"
echo ""

npm start
