#!/usr/bin/env bash
set -e

echo "======================================================"
echo "📊 Installation des dépendances Python (Matplotlib, Pandas, Seaborn)"
echo "======================================================"

# 1. Installation des paquets système précompilés (rapide et propre sur Ubuntu)
if command -v apt &>/dev/null; then
    echo "1. Mise à jour des paquets et installation via apt..."
    apt-get update -y
    apt-get install -y python3-matplotlib python3-pandas python3-seaborn python3-pip
fi

# 2. Sécurité supplémentaire via pip si disponible
if command -v pip3 &>/dev/null; then
    echo "2. Vérification des exigences via pip..."
    pip3 install -r requirements.txt --break-system-packages 2>/dev/null || true
fi

echo ""
echo "======================================================"
echo "✅ Succès ! Les bibliothèques graphiques sont prêtes."
echo "👉 Retournez sur https://vm.inspear.org/dmc/"
echo "   et cliquez sur 'Générer les graphiques' !"
echo "======================================================"
