#!/usr/bin/env bash
set -e

echo "======================================================"
echo "🔧 Configuration de Nginx pour DMC SMS Pricing (/dmc)"
echo "======================================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# 1. Sauvegarde de sécurité
if [ -f /etc/nginx/sites-available/default ]; then
    echo "1. Sauvegarde de l'ancienne configuration..."
    cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak_dmc
fi

# 2. Copie de la nouvelle configuration
echo "2. Déploiement de la configuration Nginx avec /dmc..."
cp "$REPO_DIR/deploy/nginx/default" /etc/nginx/sites-available/default

# 3. Test de syntaxe Nginx
echo "3. Vérification de la syntaxe Nginx..."
nginx -t

# 4. Rechargement du service
echo "4. Rechargement de Nginx..."
systemctl reload nginx

echo ""
echo "======================================================"
echo "✅ Succès ! Nginx est configuré et actif."
echo "👉 Accédez à l'application sur :"
echo "   https://vm.inspear.org/dmc/"
echo "======================================================"
