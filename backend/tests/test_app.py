import importlib
import sys
import unittest
from pathlib import Path
from unittest import mock

from flask import request


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class FakeRepo:
    def __init__(self):
        self.calls = []

    def get_hexes(self, res, bbox, filters):
        self.calls.append(('get_hexes', res, bbox, filters))
        return [{'h3': 'abc', 'n': 2}]

    def get_points(self, bbox, filters, limit=2000):
        self.calls.append(('get_points', bbox, filters, limit))
        return [{
            'group_id': 'gid-1',
            'provider': 'at&t',
            'conn_tag': '4G',
            'timestamp': '2026-01-01T00:00:00+00:00',
            'center': [-84.4, 33.7],
            'stats': {'down_mbps': 10}
        }]

    def get_groups_in_hex(self, h3_index, res, bbox, filters, limit=500):
        self.calls.append(('get_groups_in_hex', h3_index, res, bbox, filters, limit))
        return [{'group_id': 'gid-1'}]

    def get_group(self, group_id):
        self.calls.append(('get_group', group_id))
        if group_id == 'missing':
            return None
        return {'group_id': group_id}


def load_app_module(fake_repo):
    sys.modules.pop('app', None)
    with mock.patch('repos.factory.create_repo', return_value=fake_repo):
        return importlib.import_module('app')


class AppTests(unittest.TestCase):
    def setUp(self):
        self.repo = FakeRepo()
        self.app_module = load_app_module(self.repo)
        self.client = self.app_module.create_app().test_client()

    def test_parse_bbox_validates_shape_and_order(self):
        self.assertEqual(self.app_module._parse_bbox('-84,33,-83,34'), (-84.0, 33.0, -83.0, 34.0))
        with self.assertRaises(ValueError):
            self.app_module._parse_bbox('-83,34,-84,33')

    def test_filters_from_request_parses_values(self):
        flask_app = self.app_module.create_app()
        with flask_app.test_request_context(
            '/api/map/points?from=2026-01-01T00:00:00Z&to=2026-01-31T12:00:00Z&providers=at%26t,verizon'
            '&conn=4G,5G&dl_min=10&dl_max=50&ul_min=1&ul_max=5&lat_min=20&lat_max=80'
        ):
            filters = self.app_module._filters_from_request(request)

        self.assertEqual(filters['providers'], ['at&t', 'verizon'])
        self.assertEqual(filters['conn'], ['4G', '5G'])
        self.assertEqual(filters['dl_min'], 10.0)
        self.assertEqual(filters['lat_max'], 80.0)
        self.assertEqual(filters['from'].isoformat(), '2026-01-01T00:00:00+00:00')
        self.assertEqual(filters['to'].isoformat(), '2026-01-31T12:00:00+00:00')

    def test_health_endpoint(self):
        resp = self.client.get('/health')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json(), {'ok': True})

    def test_cors_allows_localhost_vite_ports(self):
        resp = self.client.options(
            '/api/map/points?bbox=-84,33,-83,34',
            headers={
                'Origin': 'http://localhost:5174',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'x-dashboard-secret',
            },
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5174')
        self.assertIn('x-dashboard-secret', resp.headers.get('Access-Control-Allow-Headers', ''))

    def test_map_points_route_passes_bbox_filters_and_limit(self):
        resp = self.client.get(
            '/api/map/points?bbox=-84,33,-83,34&limit=1234&providers=at%26t&conn=4G&dl_min=50'
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['points'][0]['group_id'], 'gid-1')
        self.assertIn(
            (
                'get_points',
                (-84.0, 33.0, -83.0, 34.0),
                {
                    'from': None,
                    'to': None,
                    'providers': ['at&t'],
                    'conn': ['4G'],
                    'dl_min': 50.0,
                    'dl_max': None,
                    'ul_min': None,
                    'ul_max': None,
                    'lat_min': None,
                    'lat_max': None,
                },
                1234,
            ),
            self.repo.calls,
        )

    def test_map_points_rejects_invalid_bbox(self):
        resp = self.client.get('/api/map/points?bbox=-84,33,-83')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('bbox must be', resp.get_json()['error'])

    def test_group_endpoint_returns_404_for_missing_group(self):
        resp = self.client.get('/api/group/missing')
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.get_json()['error'], 'group not found')

    def test_map_hex_rejects_invalid_resolution(self):
        resp = self.client.get('/api/map/hex?bbox=-84,33,-83,34&res=99')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('res out of range', resp.get_json()['error'])


if __name__ == '__main__':
    unittest.main()
