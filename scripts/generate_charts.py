#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DMC SMS Pricing - Générateur de Graphiques et d'Analyses Python
Auteur : Équipe DMC / SFR Business

Ce script utilise pandas, matplotlib et seaborn pour analyser l'historique
des tarifs Sinch et générer des graphiques haute définition prêts pour
le pôle facturation et le tableau de bord web.
"""

import os
import sys
import json
import argparse
from datetime import datetime

# Configuration du backend non-interactif (indispensable sur serveur / VM sans écran)
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

try:
    import pandas as pd
    import seaborn as sns
except ImportError as e:
    print(f"[ERREUR] Bibliothèque manquante : {e.name}")
    print("Veuillez installer les dépendances via : pip install -r requirements.txt")
    sys.exit(1)

# --- Charte Graphique SFR Business ---
SFR_RED = "#E2001A"
SFR_RED_DARK = "#B50014"
SFR_GRAY_DARK = "#1C2024"
SFR_GRAY_LIGHT = "#F4F6F9"
SFR_GREEN = "#0E9F6E"
SFR_BLUE = "#1E40AF"

# Configuration globale Seaborn / Matplotlib
sns.set_theme(style="whitegrid", font_scale=0.95)
plt.rcParams['font.sans-serif'] = ['DejaVu Sans', 'Arial', 'Helvetica']
plt.rcParams['axes.edgecolor'] = '#CBD2DC'
plt.rcParams['axes.linewidth'] = 0.8


def load_data(db_path):
    """Charge et structure les données depuis database.json en DataFrames pandas."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Fichier introuvable : {db_path}")

    with open(db_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    records = list(data.get("records", {}).values())
    if not records:
        print("[WARN] Aucun enregistrement trouvé dans la base.")
        return pd.DataFrame(), pd.DataFrame()

    # 1. DataFrame des tarifs actuels
    df_current = pd.DataFrame(records)

    # 2. DataFrame de l'historique chronologique
    history_rows = []
    for r in records:
        for h in r.get("history", []):
            history_rows.append({
                "id": r.get("id"),
                "country": r.get("country"),
                "operator": r.get("operator"),
                "label": f"{r.get('country')} ({r.get('operator')})",
                "date": h.get("date"),
                "price": float(h.get("price", 0)),
                "old_price": float(h.get("oldPrice", h.get("price", 0))),
                "source": h.get("source", "")
            })

    df_history = pd.DataFrame(history_rows)
    if not df_history.empty:
        df_history['date'] = pd.to_datetime(df_history['date'])
        df_history = df_history.sort_values(by=['label', 'date'])

    return df_current, df_history


def chart_top_variations(df_current, output_path):
    """Graphique 1 : Variations tarifaires récentes (% d'augmentation ou de baisse)."""
    if df_current.empty or 'percentChange' not in df_current.columns:
        return

    # Filtrer les tarifs avec variation non nulle
    variations = df_current[df_current['percentChange'] != 0].copy()
    if variations.empty:
        # Prendre les 5 plus chers si aucune variation récente
        variations = df_current.sort_values(by='currentPrice', ascending=False).head(5).copy()

    variations['label'] = variations['country'] + " - " + variations['operator']
    variations = variations.sort_values(by='percentChange', ascending=True)

    fig, ax = plt.subplots(figsize=(10, 5), dpi=150)
    colors = [SFR_RED if x > 0 else SFR_GREEN for x in variations['percentChange']]

    bars = ax.barh(variations['label'], variations['percentChange'], color=colors, height=0.55, edgecolor="none")

    # Labels de valeurs au bout de chaque barre
    for bar, val in zip(bars, variations['percentChange']):
        offset = 1.5 if val >= 0 else -1.5
        ha = 'left' if val >= 0 else 'right'
        sign = "+" if val > 0 else ""
        ax.text(val + offset, bar.get_y() + bar.get_height()/2,
                f"{sign}{val:.1f}%", va='center', ha=ha,
                fontsize=10, fontweight='bold', color=SFR_GRAY_DARK)

    ax.axvline(0, color='#8892A0', linewidth=1, linestyle='--')
    ax.set_title("Variations Récentes des Tarifs SMS Sinch (%)", fontsize=13, fontweight='bold', pad=15, color=SFR_GRAY_DARK)
    ax.set_xlabel("Variation par rapport au tarif précédent (%)", fontsize=10, color="#606873")
    plt.tight_layout()
    plt.savefig(output_path)
    plt.close()
    print(f"  ✓ Graphique généré : {output_path}")


def chart_price_by_country(df_current, output_path):
    """Graphique 2 : Comparatif des tarifs d'achat par destination."""
    if df_current.empty:
        return

    df_sorted = df_current.sort_values(by='currentPrice', ascending=False).head(12).copy()
    df_sorted['label'] = df_sorted['country'] + " (" + df_sorted['operator'] + ")"

    fig, ax = plt.subplots(figsize=(10, 6), dpi=150)
    bars = ax.bar(range(len(df_sorted)), df_sorted['currentPrice'], color=SFR_RED, width=0.6, edgecolor="none")

    ax.set_xticks(range(len(df_sorted)))
    ax.set_xticklabels(df_sorted['label'], rotation=40, ha='right', fontsize=9)
    ax.yaxis.set_major_formatter(ticker.FormatStrFormatter('%.3f €'))

    for bar, val in zip(bars, df_sorted['currentPrice']):
        ax.text(bar.get_x() + bar.get_width()/2, val + 0.001,
                f"{val:.4f}€", ha='center', va='bottom', fontsize=8.5, fontweight='bold')

    ax.set_title("Top Destinations SMS Internationales - Coût d'Achat Brut HT", fontsize=13, fontweight='bold', pad=15, color=SFR_GRAY_DARK)
    ax.set_ylabel("Tarif unitaire Sinch (€ HT)", fontsize=10, color="#606873")
    plt.tight_layout()
    plt.savefig(output_path)
    plt.close()
    print(f"  ✓ Graphique généré : {output_path}")


def chart_time_evolution(df_history, output_path):
    """Graphique 3 : Courbes d'évolution chronologique dans le temps."""
    if df_history.empty:
        return

    # Sélectionner les destinations ayant plus d'un point dans le temps
    counts = df_history.groupby('label')['date'].nunique()
    dest_with_history = counts[counts > 1].index.tolist()

    if not dest_with_history:
        # Prendre les 3 premières destinations
        dest_with_history = df_history['label'].unique()[:3].tolist()

    df_sub = df_history[df_history['label'].isin(dest_with_history)].copy()

    fig, ax = plt.subplots(figsize=(10, 5), dpi=150)

    for label in dest_with_history:
        dest_data = df_sub[df_sub['label'] == label].sort_values(by='date')
        dates = [d.strftime('%d/%m/%Y') for d in dest_data['date']]
        ax.plot(dates, dest_data['price'], marker='o', linewidth=2.5, label=label, markersize=8)

        # Afficher la valeur sur chaque point
        for x, y in zip(dates, dest_data['price']):
            ax.annotate(f"{y:.4f}€", (x, y), textcoords="offset points", xytext=(0, 10),
                        ha='center', fontsize=9, fontweight='bold', color=SFR_GRAY_DARK)

    ax.yaxis.set_major_formatter(ticker.FormatStrFormatter('%.3f €'))
    ax.set_title("Historique d'Évolution des Tarifs SMS dans le Temps", fontsize=13, fontweight='bold', pad=15, color=SFR_GRAY_DARK)
    ax.set_xlabel("Date de prise d'effet (Valid From)", fontsize=10, color="#606873")
    ax.set_ylabel("Tarif d'achat (€ HT)", fontsize=10, color="#606873")
    ax.legend(frameon=True, loc='upper left')
    plt.tight_layout()
    plt.savefig(output_path)
    plt.close()
    print(f"  ✓ Graphique généré : {output_path}")


def chart_executive_dashboard(df_current, df_history, output_path):
    """Graphique 4 : Dashboard A4 / Synthèse Directeur pour le pôle Facturation & Gabriel."""
    if df_current.empty:
        return

    fig = plt.figure(figsize=(14, 9), dpi=150)
    fig.patch.set_facecolor('#FFFFFF')
    fig.suptitle("DMC - Synthèse Analytique des Tarifs SMS Sinch & Facturation",
                 fontsize=16, fontweight='bold', color=SFR_GRAY_DARK, y=0.98)

    # 1. Panel Haut Gauche : Top Tarifs les plus chers
    ax1 = fig.add_subplot(2, 2, 1)
    top_5 = df_current.sort_values(by='currentPrice', ascending=False).head(6)
    labels = [f"{c[:10]} - {o[:12]}" for c, o in zip(top_5['country'], top_5['operator'])]
    ax1.barh(labels, top_5['currentPrice'], color=SFR_RED, height=0.6)
    ax1.set_title("Destinations les plus onéreuses (€/SMS)", fontsize=11, fontweight='bold')
    ax1.xaxis.set_major_formatter(ticker.FormatStrFormatter('%.3f €'))

    # 2. Panel Haut Droite : Dernières hausses (%)
    ax2 = fig.add_subplot(2, 2, 2)
    var = df_current[df_current['percentChange'] != 0].head(6)
    if var.empty:
        var = df_current.head(6)
    var_labels = [f"{c[:10]}" for c in var['country']]
    colors = [SFR_RED if v > 0 else SFR_GREEN for v in var['percentChange']]
    ax2.bar(var_labels, var['percentChange'], color=colors, width=0.5)
    ax2.set_title("Fluctuations récentes observées (%)", fontsize=11, fontweight='bold')
    ax2.axhline(0, color='#8892A0', linestyle='--', linewidth=0.8)

    # 3. Panel Bas Gauche : Historique chronologique (San Marino & autres)
    ax3 = fig.add_subplot(2, 2, 3)
    counts = df_history.groupby('label')['date'].nunique()
    dest_with_history = counts[counts > 1].index.tolist()
    if not dest_with_history:
        dest_with_history = df_history['label'].unique()[:2].tolist()

    for label in dest_with_history[:3]:
        sub = df_history[df_history['label'] == label].sort_values(by='date')
        dates = [d.strftime('%d/%m') for d in sub['date']]
        ax3.plot(dates, sub['price'], marker='s', linewidth=2, label=label[:18])
    ax3.set_title("Trajectoire temporelle des prix révisés", fontsize=11, fontweight='bold')
    ax3.legend(fontsize=8)

    # 4. Panel Bas Droite : Distribution générale des prix SMS
    ax4 = fig.add_subplot(2, 2, 4)
    ax4.hist(df_current['currentPrice'], bins=8, color=SFR_BLUE, edgecolor='white', alpha=0.85)
    ax4.set_title("Distribution des tarifs du catalogue (€/SMS)", fontsize=11, fontweight='bold')
    ax4.set_xlabel("Tranche tarifaire (€)", fontsize=9)
    ax4.set_ylabel("Nombre de pays/opérateurs", fontsize=9)

    plt.tight_layout(rect=[0, 0.03, 1, 0.95])
    plt.savefig(output_path)
    plt.close()
    print(f"  ✓ Dashboard exécutif généré : {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Générateur de graphiques DMC Tarifs SMS Sinch")
    parser.add_argument("--db", default=os.path.join(os.path.dirname(__file__), "..", "data", "database.json"),
                        help="Chemin vers database.json")
    parser.add_argument("--outdir", default=os.path.join(os.path.dirname(__file__), "..", "src", "public", "charts"),
                        help="Dossier de sortie des graphiques")
    args = parser.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    print(f"\n[PYTHON] Démarrage de l'analyse des tarifs depuis : {args.db}")
    print(f"[PYTHON] Enregistrement des graphiques dans : {args.outdir}\n")

    try:
        df_current, df_history = load_data(args.db)
        print(f"[INFO] Destinations chargées : {len(df_current)}, Points d'historique : {len(df_history)}")

        chart_top_variations(df_current, os.path.join(args.outdir, "top_variations.png"))
        chart_price_by_country(df_current, os.path.join(args.outdir, "price_by_country.png"))
        chart_time_evolution(df_history, os.path.join(args.outdir, "price_evolution_history.png"))
        chart_executive_dashboard(df_current, df_history, os.path.join(args.outdir, "executive_report.png"))

        print("\n✅ Tous les graphiques Python ont été générés avec succès !\n")
    except Exception as err:
        print(f"[ERREUR] Échec de la génération : {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
