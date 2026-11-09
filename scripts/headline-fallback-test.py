"""Offline actual-source regression: PYTHONPATH=. python scripts/headline-fallback-test.py.
No dependency installation or provider access. HTTPX requests use MockTransport.
"""
import contextlib
import io
import json
import os
import socket
import traceback
import unittest
from unittest.mock import patch

os.environ['LIVE_PROVIDERS'] = '1'
os.environ['FINNHUB_TOKEN'] = 'test-marker-must-not-escape'
os.environ['FINNHUB_API_KEY'] = ''
os.environ['TIINGO_TOKEN'] = ''
import httpx
from services.context_api import providers_finnhub as fh, features as f, cache
from services.context_api import app

SECRET = os.environ['FINNHUB_TOKEN']
REAL_CLIENT = httpx.Client
NEWS = [{'headline': 'FIXTURE earnings rise', 'source': 'Fixture Finnhub',
         'datetime': 1794182400, 'url': 'https://example.invalid/finnhub'}]
EXPECTED = [{'title': 'FIXTURE earnings rise', 'publisher': 'Fixture Finnhub',
             'ts': '2026-11-09T00:00:00Z', 'url': 'https://example.invalid/finnhub'}]
YAHOO = [{'title': 'Fixture news', 'publisher': 'Fixture Yahoo',
          'ts': '2026-11-09T00:00:00Z', 'url': 'https://example.invalid/yahoo'}]
CANDLES = [{'close': 100+i*.1, 'high': 101+i*.1, 'low': 99+i*.1, 'volume': 2000}
           for i in range(25)]

class HeadlineFallbackTests(unittest.TestCase):
    def setUp(self):
        self.mode = 'success'
        self.calls = []
        self.clear()
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')))
        self.stack.enter_context(patch.object(httpx, 'Client', side_effect=lambda *a, **kw: REAL_CLIENT(*a, transport=httpx.MockTransport(self.transport), **kw)))
        self.stack.enter_context(patch.object(f, 'fetch_headlines_yahoo', side_effect=self.yahoo))
        self.stack.enter_context(patch.object(f, 'fetch_quote_tiingo', side_effect=self.quote))
        self.stack.enter_context(patch.object(f, 'fetch_candles_tiingo', return_value=CANDLES))
        self.stack.enter_context(patch.object(f, '_sent_from_headlines', return_value=(0., .05, {'engine':'fixture', 'warning':None})))
        self.stack.enter_context(patch.object(f, 'iso_now', return_value='2026-11-09T12:00:00Z'))
        self.stack.enter_context(patch.object(app, 'ts_utc_now', return_value='2026-11-09T12:00:00Z'))

    def clear(self):
        for c in (fh._cache_news, fh._cache_profile, fh._cache_earn, fh._cache_quote, cache._CACHE, f._QUOTE_RING):
            c.clear()
        self.calls.clear()

    def yahoo(self, *a, **kw):
        self.calls.append('yahoo')
        return YAHOO

    def quote(self, *a, **kw):
        self.calls.append('tiingo')
        return {'last': 100., 'bid': 99.99, 'ask': 100.01, 'ts': '2026-11-09T00:00:00Z'}

    def transport(self, request):
        self.calls.append(request.url.path)
        if request.url.path.endswith('/company-news'):
            if isinstance(self.mode, type) and issubclass(self.mode, Exception):
                if issubclass(self.mode, httpx.RequestError):
                    raise self.mode(str(request.url), request=request)
                raise self.mode('fixture programming failure')
            if isinstance(self.mode, int):
                return httpx.Response(self.mode, json={'error': SECRET})
            if self.mode == 'typed':
                raise fh.FHError('fixture typed failure')
            if self.mode == 'invalid_json':
                return httpx.Response(200, text='{invalid')
            if self.mode == 'wrong_shape':
                return httpx.Response(200, json={'error': 'existing wrong-shape semantics'})
            if self.mode == 'mixed_rows':
                return httpx.Response(200, json=[None, {}, {'headline':'bad', 'datetime':'bad'}, *NEWS])
            return httpx.Response(200, json=NEWS)
        if request.url.path.endswith('/profile2'):
            return httpx.Response(200, json={'name': 'Fixture Company'})
        if request.url.path.endswith('/earnings'):
            return httpx.Response(200, json={'earningsCalendar': []})
        if request.url.path.endswith('/quote'):
            return httpx.Response(200, json={'c': 101.})
        raise AssertionError('Unexpected provider path')

    def caught(self, call):
        try:
            return call(), None
        except Exception as exc:
            return None, exc

    def assert_sanitized(self, value):
        # Boolean-only assertions keep the fake marker out of failing test output too.
        self.assertTrue(SECRET not in str(value), 'Sensitive marker escaped')
        self.assertTrue('https://finnhub.io' not in str(value), 'Provider URL escaped')

    def test_transport_and_status_normalize_without_retry_or_cache(self):
        modes = [httpx.ReadTimeout, httpx.ConnectTimeout, httpx.WriteTimeout, httpx.PoolTimeout,
                 httpx.ConnectError, httpx.ReadError, httpx.WriteError, httpx.CloseError,
                 httpx.RemoteProtocolError, httpx.LocalProtocolError, httpx.ProxyError, httpx.UnsupportedProtocol,
                 302, 400, 401, 403, 404, 429, 500, 503]
        for mode in modes:
            with self.subTest(mode=getattr(mode, '__name__', mode)):
                self.clear(); self.mode = mode
                _, exc = self.caught(lambda: fh.fetch_headlines('FIXTURE'))
                self.assertTrue(type(exc) is fh.FHError, 'Expected typed provider failure')
                expected = (f'headline HTTP status {mode}' if isinstance(mode, int)
                            else f'headline transport failure: {mode.__name__}')
                self.assertEqual(str(exc), expected)
                self.assert_sanitized(''.join(traceback.format_exception(exc)))
                self.assertEqual(self.calls, ['/api/v1/company-news'])
                self.assertFalse(fh._cache_news)

    def test_failures_continue_with_truthful_provenance_and_no_response_cache(self):
        for mode in (httpx.ReadTimeout, httpx.ConnectError, 401, 429, 503, 'typed'):
            with self.subTest(mode=getattr(mode, '__name__', mode)):
                self.clear(); self.mode = mode
                capture = io.StringIO()
                with contextlib.redirect_stdout(capture), contextlib.redirect_stderr(capture):
                    payload = app.features_v2('FIXTURE')
                self.assertTrue(payload.get('quote', {}).get('quality') == 'real', 'Healthy quote lost')
                self.assertEqual(payload['quote']['last_source'], 'tiingo_quote')
                self.assertEqual(payload['quote']['spread_quality'], 'real')
                self.assertEqual(payload['top_headline'], YAHOO[0])
                self.assertEqual(payload['refs_sources'], ['Fixture Yahoo'])
                self.assertEqual(payload['company_name'], 'Fixture Company')
                self.assertEqual(payload['sentiment']['engine'], 'fixture')
                self.assertIn('finnhub headlines:', payload['error'])
                self.assertIn('served_at', payload)
                self.assert_sanitized(json.dumps(payload) + capture.getvalue())
                self.assertFalse(cache._CACHE)
                self.assertFalse(fh._cache_news)
                self.assertEqual(self.calls, ['/api/v1/stock/profile2', '/api/v1/company-news', 'yahoo', 'tiingo', '/api/v1/calendar/earnings'])
                again = app.features_v2('FIXTURE')
                self.assertEqual(self.calls.count('/api/v1/company-news'), 2)
                self.assertEqual(self.calls.count('yahoo'), 2)
                self.assertEqual(self.calls.count('tiingo'), 2)
                self.assertFalse(cache._CACHE)

    def test_success_parity_and_headline_cache(self):
        self.assertEqual(fh.fetch_headlines(' fixture '), EXPECTED)
        self.assertEqual(fh.fetch_headlines('FIXTURE'), EXPECTED)
        self.assertEqual(self.calls, ['/api/v1/company-news'])
        self.assertEqual(fh.fetch_headlines(' '), [])
        self.assertEqual(len(fh._cache_news), 1)

    def test_success_full_payload_and_cache(self):
        p = app.features_v2('FIXTURE')
        self.assertIsNone(p['error'])
        self.assertEqual(p['top_headline'], EXPECTED[0])
        self.assertEqual(p['refs_sources'], ['Fixture Finnhub', 'Fixture Yahoo'])
        self.assertEqual(p['quote']['quality'], 'real')
        self.assertTrue(cache._CACHE)
        calls = list(self.calls)
        again = app.features_v2('FIXTURE')
        self.assertTrue(again.pop('_cache')['hit'])
        self.assertEqual(again, p)
        self.assertEqual(self.calls, calls)

    def test_typed_failure_preserved(self):
        self.mode = 'typed'
        with self.assertRaisesRegex(fh.FHError, '^fixture typed failure$'):
            fh.fetch_headlines('FIXTURE')

    def test_missing_token_preserved(self):
        with patch.object(fh, 'FINNHUB_TOKEN', ''):
            with self.assertRaisesRegex(fh.FHError, '^FINNHUB_TOKEN missing$'):
                fh.fetch_headlines('FIXTURE')
        self.assertFalse(self.calls)
        self.assertFalse(fh._cache_news)

    def test_malformed_json_still_raises_without_cache(self):
        self.mode = 'invalid_json'
        with self.assertRaises(json.JSONDecodeError):
            fh.fetch_headlines('FIXTURE')
        self.assertFalse(fh._cache_news)

    def test_existing_malformed_shapes_unchanged(self):
        self.mode = 'wrong_shape'
        self.assertEqual(fh.fetch_headlines('FIXTURE'), [])
        self.assertTrue(fh._cache_news)
        self.clear(); self.mode = 'mixed_rows'
        self.assertEqual(fh.fetch_headlines('FIXTURE'), EXPECTED)

    def test_programming_errors_not_suppressed(self):
        for error in (RuntimeError, TypeError, AssertionError):
            with self.subTest(error=error.__name__):
                self.clear(); self.mode = error
                _, exc = self.caught(lambda: fh.fetch_headlines('FIXTURE'))
                self.assertTrue(type(exc) is error, 'Programming error was concealed')
                self.assertFalse(fh._cache_news)

    def test_other_finnhub_success_paths_unchanged(self):
        self.assertEqual(fh.fetch_company_name_finnhub('FIXTURE'), 'Fixture Company')
        self.assertIsNone(fh.fetch_earnings_date('FIXTURE'))
        self.assertEqual(fh.fetch_quote_finnhub('FIXTURE'), {'last': 101., 'bid': None, 'ask': None})
        self.assertEqual(self.calls, ['/api/v1/stock/profile2', '/api/v1/calendar/earnings', '/api/v1/quote'])

    def test_live_disabled_still_makes_no_provider_requests(self):
        with patch.dict(os.environ, {'LIVE_PROVIDERS': '0'}):
            p = app.features_v2('FIXTURE')
        self.assertEqual(p['features'], f.build_features_stub())
        self.assertEqual(p['quote']['quality'], 'unknown')
        self.assertFalse(self.calls)

    def test_ordinary_finnhub_quote_fallback_still_works(self):
        with patch.object(f, 'fetch_quote_tiingo', return_value={}), patch.object(f, 'fetch_candles_tiingo', return_value=[]):
            p = app.features_v2('FIXTURE')
        self.assertEqual(p['quote']['last'], 101.)
        self.assertEqual(p['quote']['last_source'], 'finnhub_quote')
        self.assertEqual(p['quote']['quality'], 'derived')
        self.assertEqual(p['quote']['spread_quality'], 'estimated')

    def test_shared_http_get_keeps_original_error_contract(self):
        self.mode = httpx.ReadTimeout
        _, exc = self.caught(lambda: fh._http_get('/company-news', {}))
        self.assertTrue(type(exc) is httpx.ReadTimeout, 'Shared provider contract changed')

if __name__ == '__main__':
    unittest.main(verbosity=2)
