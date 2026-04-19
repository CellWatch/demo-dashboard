import unittest
from pathlib import Path
import sys


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from repos.supabase import SupabaseRpcRepo, _content_range_total  # noqa: E402


class SupabaseRepoTests(unittest.TestCase):
    def make_repo(self, page_size=2):
        repo = object.__new__(SupabaseRpcRepo)
        repo._page_size = page_size
        return repo

    def test_content_range_total_parses_counts(self):
        self.assertEqual(_content_range_total('0-999/13824'), 13824)
        self.assertIsNone(_content_range_total('0-999/*'))
        self.assertIsNone(_content_range_total(None))

    def test_get_points_pages_until_total_and_dedupes(self):
        repo = self.make_repo(page_size=2)
        calls = []

        pages = {
            0: (
                [
                    {'group_id': 'a', 'provider': 'at&t', 'conn_tag': '4G', 'timestamp': 't1', 'center': [1, 2], 'stats': {'down_mbps': 10}},
                    {'group_id': 'b', 'provider': 'verizon', 'conn_tag': '5G', 'timestamp': 't2', 'center': [3, 4], 'stats': {'down_mbps': 20}},
                ],
                5,
            ),
            2: (
                [
                    {'group_id': 'b', 'provider': 'verizon', 'conn_tag': '5G', 'timestamp': 't2', 'center': [3, 4], 'stats': {'down_mbps': 20}},
                    {'group_id': 'c', 'provider': 't-mobile', 'conn_tag': '4G', 'timestamp': 't3', 'center': [5, 6], 'stats': {'down_mbps': 30}},
                ],
                5,
            ),
            4: (
                [
                    {'group_id': 'd', 'provider': 'firstnet', 'conn_tag': 'Other', 'timestamp': 't4', 'center': [7, 8], 'stats': {'down_mbps': 40}},
                ],
                5,
            ),
        }

        def fake_page(*, bbox, filters, limit, offset, page_limit):
            calls.append((bbox, filters, limit, offset, page_limit))
            return pages[offset]

        repo._rpc_map_points_page = fake_page

        rows = repo.get_points(bbox=(-1, -1, 1, 1), filters={'providers': ['at&t']}, limit=5)

        self.assertEqual([row['group_id'] for row in rows], ['a', 'b', 'c', 'd'])
        self.assertEqual(
            calls,
            [
                ((-1, -1, 1, 1), {'providers': ['at&t']}, 5, 0, 2),
                ((-1, -1, 1, 1), {'providers': ['at&t']}, 5, 2, 2),
                ((-1, -1, 1, 1), {'providers': ['at&t']}, 5, 4, 1),
            ],
        )

    def test_get_points_stops_when_short_page_returns(self):
        repo = self.make_repo(page_size=3)
        calls = []

        def fake_page(*, bbox, filters, limit, offset, page_limit):
            calls.append((limit, offset, page_limit))
            return (
                [
                    {'group_id': 'a', 'provider': 'at&t', 'conn_tag': '4G', 'timestamp': 't1', 'center': [1, 2], 'stats': {}},
                ],
                None,
            )

        repo._rpc_map_points_page = fake_page

        rows = repo.get_points(bbox=(-1, -1, 1, 1), filters={}, limit=10)

        self.assertEqual(len(rows), 1)
        self.assertEqual(calls, [(10, 0, 3)])


if __name__ == '__main__':
    unittest.main()
