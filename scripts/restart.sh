#!/usr/bin/env bash
set -e

echo "======================================================"
echo "🔄 Redémarrage du serveur DMC SMS Pricing"
echo "======================================================"

# 1. Mise à jour des fichiers depuis Git
echo "1. Récupération des dernières mises à jour..."
git pull || true

# 2. Arrêt des anciens processus Node.js sur le port 3002
echo "2. Arrêt des anciens processus..."
killall -9 node 2>/dev/null || true
fuser -k 3002/tcp 2>/dev/null || true
sleep 1

# 3. Démarrage du nouveau serveur avec la nouvelle version
echo "3. Démarrage de la nouvelle version..."
export PORT=3002
export HOST=0.0.0.0
nohup node src/server.js > /tmp/dmc.log 2>&1 &

sleep 2

# 4. Vérification du bon démarrage
if curl -s -I http://localhost:3002 | grep -q "200 OK"; then
    echo ""
    echo "======================================================"
    echo "✅ Serveur redémarré avec succès !"
    echo "👉 Accédez à l'application sur :"
    echo "   https://vm.inspear.org/dmc/"
    echo "======================================================"
else
    echo "⚠️ Le serveur est en cours de démarrage, vérifiez /tmp/dmc.log si besoin."
fi
