class BaseRepo:
    def get_hexes(self, res: int, bbox, filters: dict):
        raise NotImplementedError

    def get_points(self, bbox, filters: dict, limit: int = 2000):
        raise NotImplementedError

    def get_groups_in_hex(self, h3_index: str, res: int, bbox, filters: dict, limit: int = 500):
        raise NotImplementedError

    def get_group(self, group_id: str):
        raise NotImplementedError


class CompositeRepo:
    def __init__(self, repos):
        self.repos = [r for r in (repos or []) if r is not None]

    def get_hexes(self, res: int, bbox, filters: dict):
        out = []
        for r in self.repos:
            out.extend(r.get_hexes(res=res, bbox=bbox, filters=filters) or [])
        return out

    def get_points(self, bbox, filters: dict, limit: int = 2000):
        out = []
        remaining = int(limit)
        for r in self.repos:
            if remaining <= 0:
                break
            pts = r.get_points(bbox=bbox, filters=filters, limit=remaining) or []
            out.extend(pts)
            remaining -= len(pts)
        return out

    def get_groups_in_hex(self, h3_index: str, res: int, bbox, filters: dict, limit: int = 500):
        out = []
        remaining = int(limit)
        for r in self.repos:
            if remaining <= 0:
                break
            rows = r.get_groups_in_hex(h3_index=h3_index, res=res, bbox=bbox, filters=filters, limit=remaining) or []
            out.extend(rows)
            remaining -= len(rows)
        return out

    def get_group(self, group_id: str):
        for r in self.repos:
            g = r.get_group(group_id)
            if g:
                return g
        return None
