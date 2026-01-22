import os
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

from repos.factory import create_repo
from dotenv import load_dotenv
load_dotenv()



def _parse_bbox(bbox_str: str):
    parts = [p.strip() for p in (bbox_str or "").split(",")]
    if len(parts) != 4:
        raise ValueError("bbox must be 'minLng,minLat,maxLng,maxLat'")
    min_lng, min_lat, max_lng, max_lat = map(float, parts)
    if min_lng > max_lng or min_lat > max_lat:
        raise ValueError("bbox min values must be <= max values")
    return min_lng, min_lat, max_lng, max_lat


def _parse_iso(dt_str: str):
    if not dt_str:
        return None
    s = dt_str.replace("Z", "+00:00")
    return datetime.fromisoformat(s)


def _parse_csv_list(v: str):
    if not v:
        return []
    return [x.strip() for x in v.split(",") if x.strip()]


def _parse_float(v: str):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except Exception:
        return None


def _parse_int(v: str, default=None):
    if v is None or v == "":
        return default
    try:
        return int(v)
    except Exception:
        return default


def _filters_from_request(req):
    return {
        "from": _parse_iso(req.args.get("from")),
        "to": _parse_iso(req.args.get("to")),
        "providers": _parse_csv_list(req.args.get("providers")),
        "conn": _parse_csv_list(req.args.get("conn")),
        "dl_min": _parse_float(req.args.get("dl_min")),
        "dl_max": _parse_float(req.args.get("dl_max")),
        "ul_min": _parse_float(req.args.get("ul_min")),
        "ul_max": _parse_float(req.args.get("ul_max")),
        "lat_min": _parse_float(req.args.get("lat_min")),
        "lat_max": _parse_float(req.args.get("lat_max")),
    }


def _require_dashboard_secret(app: Flask):
    expected = (os.getenv("DASHBOARD_SECRET") or os.getenv("VITE_DASHBOARD_SECRET") or "").strip()
    if not expected:
        print("[backend] WARNING: DASHBOARD_SECRET not set; /api/* is unprotected")
        return

    @app.before_request
    def _check():
        if request.path == "/health":
            return None
        if not request.path.startswith("/api/"):
            return None
        got = (request.headers.get("x-dashboard-secret") or "").strip()
        if got != expected:
            return jsonify({"error": "unauthorized"}), 401
        return None


def create_app():
    app = Flask(__name__)
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    #_require_dashboard_secret(app)

    repo = create_repo()

    @app.get("/health")
    def health():
        return jsonify({"ok": True})

    @app.get("/api/map/hex")
    def api_map_hex():
        res = _parse_int(request.args.get("res"), default=8)
        if res is None or res < 0 or res > 15:
            return jsonify({"error": "res out of range (0..15)"}), 400

        try:
            bbox = _parse_bbox(request.args.get("bbox", ""))
        except Exception as e:
            return jsonify({"error": str(e)}), 400

        filters = _filters_from_request(request)

        rows = repo.get_hexes(res=res, bbox=bbox, filters=filters)
        return jsonify({"res": res, "bbox": list(bbox), "hexes": rows})

    @app.get("/api/map/points")
    def api_map_points():
        try:
            bbox = _parse_bbox(request.args.get("bbox", ""))
        except Exception as e:
            return jsonify({"error": str(e)}), 400

        filters = _filters_from_request(request)
        limit = _parse_int(request.args.get("limit"), default=2000) or 2000
        limit = max(1, min(limit, 20000))

        pts = repo.get_points(bbox=bbox, filters=filters, limit=limit)

        total = len(pts)
        empty_stats = sum(1 for p in pts if not (p.get("stats") or {}))
        def miss(key):
            return sum(1 for p in pts if (p.get("stats") or {}).get(key) is None)

        print("[api_map_points] total:", total)
        print("[api_map_points] empty_stats:", empty_stats)
        print("[api_map_points] missing down_mbps:", miss("down_mbps"))
        print("[api_map_points] missing up_mbps:", miss("up_mbps"))
        print("[api_map_points] missing ping_ms:", miss("ping_ms"))
        print("[api_map_points] missing jitter_ms:", miss("jitter_ms"))
        print("[api_map_points] missing loss_pct:", miss("loss_pct"))
        return jsonify({"bbox": list(bbox), "limit": limit, "points": pts})

    @app.get("/api/hex/<h3_index>/groups")
    def api_hex_groups(h3_index):
        res = _parse_int(request.args.get("res"), default=8)
        if res is None or res < 0 or res > 15:
            return jsonify({"error": "res out of range (0..15)"}), 400

        try:
            bbox = _parse_bbox(request.args.get("bbox", ""))
        except Exception as e:
            return jsonify({"error": str(e)}), 400

        filters = _filters_from_request(request)
        limit = _parse_int(request.args.get("limit"), default=500) or 500
        limit = max(1, min(limit, 5000))

        groups = repo.get_groups_in_hex(h3_index=h3_index, res=res, bbox=bbox, filters=filters, limit=limit)
        return jsonify({"h3": h3_index, "res": res, "bbox": list(bbox), "limit": limit, "groups": groups})

    @app.get("/api/group/<group_id>")
    def api_group(group_id):
        payload = repo.get_group(group_id)
        if not payload:
            return jsonify({"error": "group not found"}), 404
        return jsonify(payload)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
