class BaseRepo:
    def get_hexes(self, res: int, bbox, filters: dict):
        raise NotImplementedError

    def get_points(self, bbox, filters: dict, limit: int = 2000):
        raise NotImplementedError

    def get_groups_in_hex(self, h3_index: str, res: int, bbox, filters: dict, limit: int = 500):
        raise NotImplementedError

    def get_group(self, group_id: str):
        raise NotImplementedError
