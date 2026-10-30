#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate price comparisons and temporal trends from the DMC price database."""

import argparse
import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
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
    max_price = selected["currentPrice"].max()
    for bar, price in zip(bars, selected["currentPrice"]):
        axis.text(price + max_price * 0.015, bar.get_y() + bar.get_height() / 2,
                  f"{price:.5f} €", va="center", fontsize=9, color=SFR_DARK)

    axis.set_xlim(0, max_price * 1.24)
    axis.set_title("Tarif moyen actuel par pays (France mise en évidence)",
                   fontsize=13, fontweight="bold", color=SFR_DARK, pad=14)
    axis.set_xlabel("Prix moyen d'achat par SMS (€)")
    axis.set_ylabel("Pays")
    axis.xaxis.set_major_formatter(ticker.FormatStrFormatter("%.3f €"))
    axis.xaxis.grid(True, alpha=0.3)
    axis.set_axisbelow(True)
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)


def chart_temporal_price_evolution(history, output_path):
    if history.empty:
        chart_insufficient_history(output_path)
        return

    history = history.copy()
    history["year"] = history["date"].dt.year
    history["month"] = history["date"].dt.to_period("M").dt.to_timestamp()
    multiple_years = history["year"].nunique() > 1
    period_column = "year" if multiple_years else "month"
    coverage = history.groupby("country")[period_column].nunique().sort_values(ascending=False)
    selected_countries = coverage[coverage > 1].head(5).index.tolist()

    france = next((country for country in history["country"].unique()
                   if country.casefold() == "france"), None)
    if france and coverage.get(france, 0) > 1 and france not in selected_countries:
        selected_countries.append(france)

    if not selected_countries:
        chart_insufficient_history(output_path)
        return

    palette = sns.color_palette("deep", n_colors=len(selected_countries))
    colors = {
        country: SFR_RED if country.casefold() == "france" else palette[index]
        for index, country in enumerate(selected_countries)
    }
    trend = (
        history[history["country"].isin(selected_countries)]
        .groupby([period_column, "country"], as_index=False)["price"]
        .mean()
    )

    fig, axis = plt.subplots(figsize=(11, 6), dpi=160)
    for country in selected_countries:
        series = trend[trend["country"] == country].sort_values(period_column)
        if not series.empty:
            axis.plot(series[period_column], series["price"], marker="o",
                      linewidth=2.5, label=country, color=colors[country])

    frequency = "annuelle" if multiple_years else "mensuelle"
    axis.set_title(f"Évolution {frequency} du prix moyen par pays",
                   fontsize=13, fontweight="bold", color=SFR_DARK, pad=14)
    axis.set_xlabel("Année" if multiple_years else "Mois de prise d'effet")
    axis.set_ylabel("Prix moyen d'achat par SMS (€)")
    if multiple_years:
        years = sorted(history["year"].unique())
        axis.xaxis.set_major_locator(ticker.FixedLocator(years))
        axis.xaxis.set_major_formatter(ticker.FormatStrFormatter("%d"))
    else:
        axis.xaxis.set_major_locator(mdates.MonthLocator(interval=1))
        axis.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
        fig.autofmt_xdate(rotation=30, ha="right")
    axis.yaxis.set_major_formatter(ticker.FormatStrFormatter("%.5f €"))
    axis.legend(title="Pays", loc="best")
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)


def chart_insufficient_history(output_path):
    fig, axis = plt.subplots(figsize=(11, 6), dpi=160)
    axis.axis("off")
    axis.text(0.5, 0.58, "Historique insuffisant pour tracer une évolution",
              ha="center", va="center", fontsize=15, fontweight="bold",
              color=SFR_DARK, transform=axis.transAxes)
    axis.text(0.5, 0.43,
              "Il faut au moins deux périodes tarifaires distinctes pour un pays.",
              ha="center", va="center", fontsize=11, color="#606873",
              transform=axis.transAxes)
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
        chart_temporal_price_evolution(
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
