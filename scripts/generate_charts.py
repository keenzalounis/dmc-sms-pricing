#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate price comparisons and annual trends from the DMC price database."""

import argparse
import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import pandas as pd
import seaborn as sns

SFR_RED = "#E2001A"
SFR_BLUE = "#1E40AF"
SFR_DARK = "#1C2024"

sns.set_theme(style="whitegrid")


def load_data(database_path):
    with open(database_path, "r", encoding="utf-8") as database_file:
        database = json.load(database_file)

    records = list(database.get("records", {}).values())
    current = pd.DataFrame(records)
    if current.empty:
        raise ValueError("Aucun tarif courant dans la base.")
    current["currentPrice"] = pd.to_numeric(current["currentPrice"], errors="coerce")
    current = current.dropna(subset=["country", "currentPrice"])

    history_rows = []
    for record in records:
        for point in record.get("history", []):
            history_rows.append({
                "country": record.get("country"),
                "date": point.get("date"),
                "price": point.get("price")
            })

    history = pd.DataFrame(history_rows)
    if not history.empty:
        history["date"] = pd.to_datetime(history["date"], errors="coerce")
        history["price"] = pd.to_numeric(history["price"], errors="coerce")
        history = history.dropna(subset=["country", "date", "price"])
    return current, history


def chart_average_price_by_country(current, output_path):
    averages = current.groupby("country", as_index=False)["currentPrice"].mean()
    selected = averages.nlargest(12, "currentPrice")
    france = averages[averages["country"].str.casefold() == "france"]
    selected = pd.concat([selected, france]).drop_duplicates(subset=["country"])
    selected = selected.sort_values("currentPrice")

    colors = [
        SFR_RED if country.casefold() == "france" else SFR_BLUE
        for country in selected["country"]
    ]
    fig, axis = plt.subplots(figsize=(11, max(5, len(selected) * 0.38)), dpi=160)
    bars = axis.barh(selected["country"], selected["currentPrice"], color=colors, height=0.65)
    for bar, price in zip(bars, selected["currentPrice"]):
        axis.text(price, bar.get_y() + bar.get_height() / 2, f"  {price:.5f} €",
                  va="center", fontsize=9, color=SFR_DARK)

    axis.set_title("Tarif moyen actuel par pays (France mise en évidence)",
                   fontsize=13, fontweight="bold", color=SFR_DARK, pad=14)
    axis.set_xlabel("Prix moyen d'achat par SMS (€)")
    axis.set_ylabel("Pays")
    axis.xaxis.set_major_formatter(ticker.FormatStrFormatter("%.3f €"))
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)


def chart_annual_price_evolution(history, output_path):
    if history.empty:
        raise ValueError("Aucun historique de prix disponible pour la comparaison temporelle.")

    history = history.copy()
    history["year"] = history["date"].dt.year
    history["period"] = history["date"].dt.strftime("%Y-%m")

    # Sélectionner les pays les plus fréquents + France
    counts = history.groupby("country").size().sort_values(ascending=False)
    selected_countries = counts.head(5).index.tolist()
    france = next((country for country in history["country"].unique()
                   if country.casefold() == "france"), None)
    if france and france not in selected_countries:
        selected_countries.append(france)

    # Déterminer la granularité temporelle adaptée
    unique_years = sorted(history["year"].dropna().unique().astype(int))
    unique_periods = sorted(history["period"].dropna().unique())

    palette = sns.color_palette("deep", n_colors=len(selected_countries))
    colors = {
        country: SFR_RED if country.casefold() == "france" else palette[index]
        for index, country in enumerate(selected_countries)
    }

    # CAS 1 : Plusieurs années distinctes -> Évolution annuelle
    if len(unique_years) >= 2:
        yearly = (
            history[history["country"].isin(selected_countries)]
            .groupby(["year", "country"], as_index=False)["price"]
            .mean()
        )
        fig, axis = plt.subplots(figsize=(11, 6), dpi=160)
        for country in selected_countries:
            series = yearly[yearly["country"] == country].sort_values("year")
            if series.empty:
                continue
            axis.plot(series["year"], series["price"], marker="o", linewidth=2.5,
                      label=country, color=colors[country])
            for year, price in zip(series["year"], series["price"]):
                axis.annotate(f"{price:.5f} €", (year, price), textcoords="offset points",
                              xytext=(0, 9), ha="center", fontsize=8)

        axis.set_title("Évolution annuelle des tarifs SMS par pays",
                       fontsize=13, fontweight="bold", color=SFR_DARK, pad=14)
        axis.set_xlabel("Année")
        axis.set_ylabel("Prix moyen (€ HT / SMS)")
        axis.set_xlim(min(unique_years) - 0.4, max(unique_years) + 0.4)
        axis.xaxis.set_major_locator(ticker.FixedLocator(unique_years))
        axis.yaxis.set_major_formatter(ticker.FormatStrFormatter("%.3f €"))
        axis.legend(title="Pays", loc="upper right")
        fig.tight_layout()
        fig.savefig(output_path, bbox_inches="tight")
        plt.close(fig)

    # CAS 2 : Une seule année mais plusieurs mois -> Évolution mensuelle détaillée
    elif len(unique_periods) >= 2:
        monthly = (
            history[history["country"].isin(selected_countries)]
            .groupby(["period", "country"], as_index=False)["price"]
            .mean()
        )
        fig, axis = plt.subplots(figsize=(11, 6), dpi=160)
        for country in selected_countries:
            series = monthly[monthly["country"] == country].sort_values("period")
            if series.empty:
                continue
            axis.plot(series["period"], series["price"], marker="o", linewidth=2.5,
                      label=country, color=colors[country])
            for period, price in zip(series["period"], series["price"]):
                axis.annotate(f"{price:.5f} €", (period, price), textcoords="offset points",
                              xytext=(0, 9), ha="center", fontsize=8)

        axis.set_title(f"Évolution mensuelle des tarifs SMS ({unique_years[0] if unique_years else ''})",
                       fontsize=13, fontweight="bold", color=SFR_DARK, pad=14)
        axis.set_xlabel("Mois de prise d'effet")
        axis.set_ylabel("Prix moyen (€ HT / SMS)")
        axis.yaxis.set_major_formatter(ticker.FormatStrFormatter("%.3f €"))
        axis.legend(title="Pays", loc="upper right")
        fig.tight_layout()
        fig.savefig(output_path, bbox_inches="tight")
        plt.close(fig)

    # CAS 3 : Une seule date dans l'historique -> Diagramme comparatif propre
    else:
        averages = (
            history[history["country"].isin(selected_countries)]
            .groupby("country", as_index=False)["price"]
            .mean()
            .sort_values("price", ascending=True)
        )
        fig, axis = plt.subplots(figsize=(10, 5), dpi=160)
        bar_colors = [colors[c] for c in averages["country"]]
        bars = axis.barh(averages["country"], averages["price"], color=bar_colors, height=0.55)

        for bar, price in zip(bars, averages["price"]):
            axis.text(price + 0.001, bar.get_y() + bar.get_height() / 2,
                      f"  {price:.5f} €", va="center", fontsize=9, fontweight="bold", color=SFR_DARK)

        axis.set_title(f"Tarifs moyens par pays (Période : {unique_periods[0] if unique_periods else 'actuelle'})",
                       fontsize=13, fontweight="bold", color=SFR_DARK, pad=14)
        axis.set_xlabel("Prix moyen (€ HT / SMS)")
        axis.set_ylabel("Pays")
        axis.xaxis.set_major_formatter(ticker.FormatStrFormatter("%.3f €"))
        fig.tight_layout()
        fig.savefig(output_path, bbox_inches="tight")
        plt.close(fig)


def main():
    script_directory = os.path.dirname(__file__)
    parser = argparse.ArgumentParser(description="Graphiques analytiques des tarifs SMS DMC")
    parser.add_argument(
        "--db",
        default=os.path.join(script_directory, "..", "data", "database.json"),
        help="Chemin vers database.json"
    )
    parser.add_argument(
        "--outdir",
        default=os.path.join(script_directory, "..", "src", "public", "charts"),
        help="Dossier de sortie des graphiques"
    )
    args = parser.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    try:
        current, history = load_data(args.db)
        chart_average_price_by_country(
            current, os.path.join(args.outdir, "average_price_by_country.png")
        )
        chart_annual_price_evolution(
            history, os.path.join(args.outdir, "annual_price_evolution.png")
        )
        for old_chart in ("top_variations.png", "price_by_country.png",
                          "price_evolution_history.png", "executive_report.png"):
            old_path = os.path.join(args.outdir, old_chart)
            if os.path.exists(old_path):
                os.remove(old_path)
        print("Graphiques Python générés avec succès.")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Erreur de génération des graphiques : {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
