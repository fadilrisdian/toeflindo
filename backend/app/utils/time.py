"""WIB (UTC+7) datetime helpers used throughout the app."""
from datetime import datetime, timedelta, timezone

WIB = timezone(timedelta(hours=7))


def now_wib() -> str:
    """Return current WIB datetime as 'YYYY-MM-DD HH:MM:SS'."""
    return datetime.now(WIB).strftime("%Y-%m-%d %H:%M:%S")


def today_wib() -> str:
    """Return current WIB date as 'YYYY-MM-DD'."""
    return datetime.now(WIB).strftime("%Y-%m-%d")


def wib_date(days_offset: int = 0) -> str:
    """Return WIB date offset by N days."""
    return (datetime.now(WIB) + timedelta(days=days_offset)).strftime("%Y-%m-%d")
