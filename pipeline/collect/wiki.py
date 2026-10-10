"""Wikipedia daily pageviews: a proxy for public curiosity, kept separate from conversation volume."""
from __future__ import annotations

from datetime import date, timedelta
from urllib.parse import quote

from .. import config
from ..common import get, today

API = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{project}/all-access/user/{article}/daily/{start}/{end}"


def collect(since: date) -> dict[str, dict[str, int]]:
    """{YYYY-MM-DD: {vaccine: views}} summed over each group's zh and en articles."""
    end = today() - timedelta(days=1)          # the API publishes complete days only
    out: dict[str, dict[str, int]] = {}
    for vaccine, articles in config.WIKI_ARTICLES.items():
        for project, article in articles:
            url = API.format(project=project, article=quote(article, safe=""),
                             start=since.strftime("%Y%m%d"), end=end.strftime("%Y%m%d"))
            for row in get(url, min_interval=0.2).json().get("items", []):
                day = f"{row['timestamp'][:4]}-{row['timestamp'][4:6]}-{row['timestamp'][6:8]}"
                out.setdefault(day, {}).setdefault(vaccine, 0)
                out[day][vaccine] += row["views"]
    return out
