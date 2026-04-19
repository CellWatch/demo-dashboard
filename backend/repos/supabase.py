import os
import math
import requests
import h3


def _median(vals):
    vals = [v for v in (vals or []) if v is not None and not (isinstance(v, float) and math.isnan(v))]
    if not vals:
        return None
    vals.sort()
    n = len(vals)
    mid = n // 2
    if n % 2 == 1:
        return float(vals[mid])
    return float((vals[mid - 1] + vals[mid]) / 2.0)


def _to_float(v):
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _iso(v):
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _content_range_total(v):
    if not v or "/" not in v:
        return None
    total = v.split("/", 1)[1].strip()
    if not total or total == "*":
        return None
    try:
        return int(total)
    except Exception:
        return None


class SupabaseRpcRepo:
    def __init__(self):
        url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").strip()
        anon = (os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or "").strip()
        service = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        dash = (os.getenv("DASHBOARD_SECRET") or os.getenv("VITE_DASHBOARD_SECRET") or "").strip()


        if not url:
            raise RuntimeError("SUPABASE_URL (or VITE_SUPABASE_URL) is required")

        key = service or anon
        if not key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_ANON_KEY is required")

        print("[supabase] url:", url)
        print("[supabase] anon len:", len(anon) if anon else 0)
        print("[supabase] service len:", len(service) if service else 0)
        print("[supabase] using:", "service" if service else "anon")
        print("[supabase] key len:", len(key) if key else 0)
        
        self.base = url.rstrip("/") + "/rest/v1/rpc"
        self.http = requests.Session()
        self.http.headers.update({
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        })

        self._dash = dash
        try:
            self._page_size = max(1, int((os.getenv("SUPABASE_RPC_PAGE_SIZE") or "1000").strip()))
        except Exception:
            self._page_size = 1000

    def _rpc_response(self, fn: str, payload: dict, params: dict | None = None, headers: dict | None = None):
        merged_headers = {}
        if headers:
            merged_headers.update(headers)
        auth_headers = {}
        if self._dash:
            auth_headers["x-dashboard-secret"] = self._dash
        merged_headers.update(auth_headers)

        r = self.http.post(
            f"{self.base}/{fn}",
            params=params,
            json=payload,
            headers=merged_headers,
            timeout=90,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"RPC {fn} failed ({r.status_code}): {r.text}")
        return r

    def _rpc(self, fn: str, payload: dict, params: dict | None = None, headers: dict | None = None):
        r = self._rpc_response(fn, payload, params=params, headers=headers)
        if not r.text:
            return None
        return r.json()

    def _map_points_payload(self, bbox, filters: dict, limit: int):
        min_lng, min_lat, max_lng, max_lat = bbox
        return {
            "min_lng": float(min_lng),
            "min_lat": float(min_lat),
            "max_lng": float(max_lng),
            "max_lat": float(max_lat),
            "t_from": _iso(filters.get("from")),
            "t_to": _iso(filters.get("to")),
            "providers": filters.get("providers") or [],
            "conn": filters.get("conn") or [],
            "dl_min": filters.get("dl_min"),
            "dl_max": filters.get("dl_max"),
            "ul_min": filters.get("ul_min"),
            "ul_max": filters.get("ul_max"),
            "lat_min": filters.get("lat_min"),
            "lat_max": filters.get("lat_max"),
            "lim": int(limit),
        }

    def _rpc_map_points_page(self, bbox, filters: dict, limit: int, offset: int, page_limit: int):
        if page_limit <= 0:
            return [], None
        payload = self._map_points_payload(bbox=bbox, filters=filters, limit=limit)
        resp = self._rpc_response(
            "rpc_map_points",
            payload,
            params={"limit": int(page_limit), "offset": int(offset)},
            headers={"Prefer": "count=exact"},
        )
        rows = resp.json() if resp.text else []
        total = _content_range_total(resp.headers.get("content-range"))
        return rows or [], total

    def _normalize_point_row(self, row: dict):
        return {
            "group_id": row.get("group_id"),
            "provider": row.get("provider"),
            "conn_tag": row.get("conn_tag"),
            "timestamp": _iso(row.get("timestamp")),
            "center": row.get("center"),
            "stats": row.get("stats") or {},
        }

    def _point_key(self, row: dict):
        group_id = row.get("group_id")
        if group_id:
            return ("group_id", str(group_id))

        center = row.get("center") or []
        center_key = tuple(center) if isinstance(center, list) else None
        stats = row.get("stats") or {}
        stats_key = tuple(sorted(stats.items()))
        return (
            "fallback",
            row.get("timestamp"),
            row.get("provider"),
            row.get("conn_tag"),
            center_key,
            stats_key,
        )

    def get_points(self, bbox, filters: dict, limit: int = 2000):
        requested = max(1, int(limit))
        page_size = min(self._page_size, requested)
        out = []
        seen = set()
        offset = 0
        total = None
        logged_paging = False

        while len(out) < requested:
            remaining = requested - offset
            if total is not None:
                remaining = min(remaining, total - offset)
            if remaining <= 0:
                break

            batch_size = min(page_size, remaining)
            rows, page_total = self._rpc_map_points_page(
                bbox=bbox,
                filters=filters,
                limit=requested,
                offset=offset,
                page_limit=batch_size,
            )
            if total is None and page_total is not None:
                total = page_total
            if not logged_paging and total is not None and total > page_size:
                print(
                    "[supabase] paging rpc_map_points:",
                    f"requested={requested}",
                    f"total={total}",
                    f"page_size={page_size}",
                )
                logged_paging = True
            if not rows:
                break

            for r in rows:
                normalized = self._normalize_point_row(r)
                key = self._point_key(normalized)
                if key in seen:
                    continue
                seen.add(key)
                out.append(normalized)
                if len(out) >= requested:
                    break

            offset += len(rows)
            if len(rows) < batch_size:
                break

        return out

    def get_hexes(self, res: int, bbox, filters: dict):
        pts = self.get_points(bbox=bbox, filters=filters, limit=20000)

        buckets = {}
        for p in pts:
            center = p.get("center") or []
            if not isinstance(center, list) or len(center) != 2:
                continue
            lon = _to_float(center[0])
            lat = _to_float(center[1])
            if lon is None or lat is None:
                continue

            try:
                cell = h3.latlng_to_cell(float(lat), float(lon), int(res))
            except Exception:
                continue

            b = buckets.get(cell)
            if b is None:
                b = {
                    "h3": str(cell),
                    "n": 0,
                    "dl": [],
                    "ul": [],
                    "ping": [],
                    "jitter": [],
                    "loss": [],
                    "sum_lon": 0.0,
                    "sum_lat": 0.0,
                    "cnt_center": 0,
                }
                buckets[cell] = b

            stats = p.get("stats") or {}
            b["n"] += 1
            b["dl"].append(_to_float(stats.get("down_mbps")))
            b["ul"].append(_to_float(stats.get("up_mbps")))
            b["ping"].append(_to_float(stats.get("ping_ms")))
            b["jitter"].append(_to_float(stats.get("jitter_ms")))
            b["loss"].append(_to_float(stats.get("loss_pct")))
            b["sum_lon"] += float(lon)
            b["sum_lat"] += float(lat)
            b["cnt_center"] += 1

        out = []
        for _, b in buckets.items():
            center = None
            if b["cnt_center"] > 0:
                center = [b["sum_lon"] / b["cnt_center"], b["sum_lat"] / b["cnt_center"]]

            out.append({
                "h3": b["h3"],
                "n": int(b["n"]),
                "dl_p50_mbps": _median(b["dl"]),
                "ul_p50_mbps": _median(b["ul"]),
                "ping_p50_ms": _median(b["ping"]),
                "jitter_p50_ms": _median(b["jitter"]),
                "loss_p50_pct": _median(b["loss"]),
                "center": center,
            })

        return out

    def get_groups_in_hex(self, h3_index: str, res: int, bbox, filters: dict, limit: int = 500):
        pts = self.get_points(bbox=bbox, filters=filters, limit=20000)

        matched = []
        for p in pts:
            center = p.get("center") or []
            if not isinstance(center, list) or len(center) != 2:
                continue
            lon = _to_float(center[0])
            lat = _to_float(center[1])
            if lon is None or lat is None:
                continue

            try:
                cell = h3.latlng_to_cell(float(lat), float(lon), int(res))
            except Exception:
                continue

            if str(cell) != str(h3_index):
                continue

            matched.append(p)

        matched.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
        matched = matched[: int(limit)]

        out = []
        for p in matched:
            stats = p.get("stats") or {}
            out.append({
                "group_id": p.get("group_id"),
                "provider": p.get("provider"),
                "conn_tag": p.get("conn_tag"),
                "timestamp": _iso(p.get("timestamp")),
                "center": p.get("center"),
                "stats": {
                    "down_mbps": _to_float(stats.get("down_mbps")),
                    "up_mbps": _to_float(stats.get("up_mbps")),
                    "ping_ms": _to_float(stats.get("ping_ms")),
                    "jitter_ms": _to_float(stats.get("jitter_ms")),
                    "loss_pct": _to_float(stats.get("loss_pct")),
                },
            })
        return out

    def get_group(self, group_id: str):
        return self._rpc("rpc_group_detail", {"group_id": str(group_id)})
