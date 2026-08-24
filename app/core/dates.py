"""
Shared date-filter parsing.

The frontend always builds "day" filters as YYYY-MM-DDT00:00:00.000Z /
YYYY-MM-DDT23:59:59.999Z (see orders-page.tsx, customers-page.tsx, etc.) —
but the calendar date in that string is the STORE's own local date
(Algeria, UTC+1, no DST), not a UTC one. The "Z" suffix is just how the
string is formatted, not a statement about which timezone the boundary is
actually in.

Parsing it as literal UTC shifts every "aujourd'hui" / date-range filter by
1 hour: an order placed at 00:03 Algeria time is 23:03 UTC the PREVIOUS
day, so a naive `datetime.fromisoformat(...)` parse put it just outside
"today"'s lower bound — it silently landed in "yesterday" instead, on every
endpoint using this pattern (orders, customers, landing pages, users,
products, audit log).
"""
from datetime import datetime, timedelta

ALGERIA_UTC_OFFSET_HOURS = 1


def parse_local_date_filter(date_str: str, is_end_of_day: bool = False) -> datetime:
    """
    Parse a 'YYYY-MM-DDTHH:MM:SS(.sss)Z' or 'YYYY-MM-DD' filter string as Algeria-local
    wall-clock time, returning the equivalent naive-UTC datetime — ready to
    compare directly against DB columns, which are stored naive-UTC.
    """
    cleaned = date_str.strip()
    if len(cleaned) == 10 and cleaned.count("-") == 2:
        if is_end_of_day:
            cleaned = f"{cleaned}T23:59:59.999999Z"
        else:
            cleaned = f"{cleaned}T00:00:00.000Z"
    elif is_end_of_day and "T00:00:00" in cleaned:
        # If an end_date was incorrectly formatted with midnight T00:00:00
        cleaned = cleaned.replace("T00:00:00.000Z", "T23:59:59.999999Z").replace("T00:00:00Z", "T23:59:59.999999Z")

    dt = datetime.fromisoformat(cleaned.replace("Z", "+00:00")).replace(tzinfo=None)
    if dt.year < 2020 or dt.year > 2050:
        raise ValueError(f"Invalid filter year: {dt.year}")
    return dt - timedelta(hours=ALGERIA_UTC_OFFSET_HOURS)
