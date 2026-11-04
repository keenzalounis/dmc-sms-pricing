#!/usr/bin/env python3
"""Render one operator's tariff history as a PNG on stdout."""

import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    if len(sys.argv) != 2:
        raise ValueError("An operator record id is required.")

    database_path = Path(__file__).resolve().parents[1] / "data" / "database.json"
    with database_path.open(encoding="utf-8") as database_file:
        database = json.load(database_file)

    record = database.get("records", {}).get(sys.argv[1])
    if record is None:
        raise ValueError("The requested operator does not exist.")

    points = []
    for item in record.get("history", []):
        try:
            price = float(item.get("price"))
        except (TypeError, ValueError):
            continue
        if math.isfinite(price) and price > 0:
            points.append((str(item.get("date") or "Date inconnue"), price))

    points.sort(key=lambda point: point[0])
    if not points:
        price = float(record.get("currentPrice", 0))
        if not math.isfinite(price) or price <= 0:
            raise ValueError("No valid tariff history is available for this operator.")
        points = [(str(record.get("validFrom") or "Tarif actuel"), price)]

    labels, prices = zip(*points)
    figure, axis = plt.subplots(figsize=(10, 4.5))
    axis.plot(range(len(prices)), prices, color="#E2001A", marker="o", linewidth=2.2, markersize=5)
    axis.fill_between(range(len(prices)), prices, color="#E2001A", alpha=0.08)
    axis.set_title(f"{record.get('country', '')} — {record.get('operator', '')}", loc="left", fontsize=13, weight="bold")
    axis.set_ylabel("Tarif (€ HT / SMS)")
    axis.set_xlabel("Date d'effet")
    axis.set_ylim(bottom=0)
    axis.grid(axis="y", color="#E2E8F0", linewidth=0.8)
    axis.spines["top"].set_visible(False)
    axis.spines["right"].set_visible(False)

    tick_indices = list(range(0, len(labels), max(1, math.ceil(len(labels) / 10))))
    if tick_indices[-1] != len(labels) - 1:
        tick_indices.append(len(labels) - 1)
    axis.set_xticks(tick_indices, [labels[index] for index in tick_indices], rotation=30, ha="right")
    figure.tight_layout()
    figure.savefig(sys.stdout.buffer, format="png", dpi=140)
    plt.close(figure)


if __name__ == "__main__":
    main()
