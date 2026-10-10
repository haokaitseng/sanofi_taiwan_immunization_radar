"""Collectors. Each item collector exposes collect(since, backfill) -> list[Item]."""
from types import SimpleNamespace

from . import apify, cdc, gdelt, gnews, ptt, tfda

# Policy first, then media, then social: if a run is cut short, the most important sources are in.
SOURCES = {
    "cdc": cdc,
    "tfda": tfda,
    "gnews": gnews,
    "gdelt": gdelt,
    "ptt": ptt,
    "threads": SimpleNamespace(collect=apify.threads),
    "facebook": SimpleNamespace(collect=apify.facebook),
}
