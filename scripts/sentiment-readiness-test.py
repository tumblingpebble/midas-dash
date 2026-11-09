"""Fast offline regressions. ML dependencies are stubbed before importing the service."""
import importlib
import sys
import threading
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

sys.modules['transformers'] = types.SimpleNamespace(pipeline=lambda *a, **k: None)
sys.modules['setfit'] = types.SimpleNamespace(SetFitModel=types.SimpleNamespace(from_pretrained=lambda p: None))
from services.sentiment_api import app as service
from services.sentiment_api import fallback_setfit as fallback

PROBS = [{'label': 'positive', 'score': .8}, {'label': 'negative', 'score': .1}, {'label': 'neutral', 'score': .1}]
FB = {'label': 'positive', 'confidence': .9, 'model_version': 'test-setfit', 'warning': None}

class ReadinessTests(unittest.TestCase):
    def setUp(self):
        importlib.reload(fallback)
        importlib.reload(service)

    def test_health_is_lazy(self):
        with patch.object(service, 'pipeline') as loader:
            self.assertEqual(service.healthz()['status'], 'ok')
            loader.assert_not_called()

    def test_finbert_single_flight(self):
        calls = []
        def load(*args, **kwargs):
            calls.append(1)
            time.sleep(.05)
            return object()
        with patch.object(service, 'pipeline', side_effect=load):
            with ThreadPoolExecutor(8) as pool:
                models = list(pool.map(lambda _: service.get_pipe(), range(8)))
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(m is models[0] for m in models))

    def test_setfit_single_flight(self):
        calls = []
        def load(*args, **kwargs):
            calls.append(1)
            time.sleep(.05)
            return object()
        with patch.object(fallback.Path, 'exists', return_value=True), patch.object(fallback.SetFitModel, 'from_pretrained', side_effect=load):
            with ThreadPoolExecutor(8) as pool:
                models = list(pool.map(lambda _: fallback.get_setfit_model(), range(8)))
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(m is models[0] for m in models))

    def test_first_load_failure_warning(self):
        with patch.object(service, 'pipeline', side_effect=RuntimeError), patch.object(service, 'score_with_setfit', return_value=FB):
            result = service.analyze(service.SentIn(texts=['Ordinary business news']))
        self.assertEqual(result['engine'], 'setfit_fallback')
        self.assertIn('finbert_load_failed:RuntimeError', result['warning'] or '')

    def test_batch_failure_has_honest_provenance(self):
        service.pipe = lambda *a, **k: PROBS
        with patch.object(service, '_finbert_prob_score', side_effect=[(.7, .8), RuntimeError()]), patch.object(service, 'score_with_setfit', return_value=FB) as score:
            result = service.analyze(service.SentIn(texts=['First ordinary news', 'Second ordinary news']))
        self.assertEqual(result['samples'], [.7, .9])
        self.assertEqual(result['sample_engines'], ['finbert', 'setfit_fallback'])
        self.assertIsNone(result['model_version'])
        self.assertEqual(score.call_count, 1)
        self.assertEqual(result['engine'], 'mixed')

    def test_ready_primary_does_not_load_fallback(self):
        service.pipe = lambda *a, **k: PROBS
        with patch.object(service, 'score_with_setfit') as score:
            result = service.readyz()
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['engine'], 'finbert')
        score.assert_not_called()

    def test_ready_fallback_and_lexicon_unavailable(self):
        service.pipe_disabled_reason = 'test_primary_unavailable'
        with patch.object(service, 'score_with_setfit', return_value=FB):
            self.assertEqual(service.readyz()['status'], 'degraded')
        with patch.object(service, 'score_with_setfit', side_effect=RuntimeError):
            result = service.readyz()
        self.assertEqual(result.status_code, 503)

    def test_failed_finbert_initialization_is_single_flight_and_sticky(self):
        def load(*args, **kwargs):
            time.sleep(.03)
            raise RuntimeError()
        with patch.object(service, 'pipeline', side_effect=load) as loader:
            with ThreadPoolExecutor(8) as pool:
                self.assertEqual(list(pool.map(lambda _: service.get_pipe(), range(8))), [None] * 8)
            self.assertIsNone(service.get_pipe())
            self.assertEqual(loader.call_count, 1)

    def test_failed_setfit_initialization_is_single_flight_and_sticky(self):
        def load(*args, **kwargs):
            time.sleep(.03)
            raise RuntimeError()
        with patch.object(fallback.Path, 'exists', return_value=True), patch.object(fallback.SetFitModel, 'from_pretrained', side_effect=load) as loader:
            with ThreadPoolExecutor(8) as pool:
                self.assertEqual(list(pool.map(lambda _: fallback.get_setfit_model(), range(8))), [None] * 8)
            self.assertIsNone(fallback.get_setfit_model())
            self.assertEqual(loader.call_count, 1)

    def test_ready_does_not_use_response_cache_or_rule_gate(self):
        self.assertEqual(fallback.rule_gate('The company published its quarterly financial report today.'), (None, None))
        service.pipe = lambda *a, **k: PROBS
        self.assertEqual(service.readyz()['status'], 'ready')
        service.pipe = lambda *a, **k: (_ for _ in ()).throw(ValueError())
        with patch.object(service, 'score_with_setfit', side_effect=RuntimeError):
            result = service.readyz()
        self.assertEqual(result.status_code, 503)
        self.assertIn('finbert_runtime_failed:ValueError', result.body.decode())
        self.assertEqual(service._CACHE, {})

    def test_lexicon_fallback_remains_available(self):
        with patch.object(service, 'pipeline', side_effect=ValueError), patch.object(service, 'score_with_setfit', side_effect=RuntimeError):
            result = service.analyze(service.SentIn(texts=['record surge']))
        self.assertEqual(result['engine'], 'lexicon')
        self.assertEqual(result['samples'], [2 / 3])
        self.assertIsNone(result['confidence'])
        self.assertEqual(result['sample_model_versions'], [None])
        self.assertIn('finbert_load_failed:ValueError', result['warning'])

    def test_health_after_failure_stays_live(self):
        service.pipe_disabled_reason = 'test_failure'
        with patch.object(service, 'get_pipe', side_effect=AssertionError):
            result = service.healthz()
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['check'], 'liveness')
        self.assertEqual(result['pipe_disabled_reason'], 'test_failure')

    def test_primary_batch_metadata_aligns_without_backup(self):
        service.pipe = lambda *a, **k: PROBS
        with patch.object(service, 'score_with_setfit', side_effect=AssertionError):
            result = service.analyze(service.SentIn(texts=['One', 'Two', 'Three']))
        self.assertEqual(result['engine'], 'finbert')
        self.assertEqual(result['sample_engines'], ['finbert'] * 3)
        self.assertEqual(result['sample_model_versions'], ['ProsusAI/finbert'] * 3)
        self.assertEqual(len(result['samples']), result['n'])
        self.assertIsNone(result['warning'])

    def test_mixed_three_paths_keep_original_samples_and_alignment(self):
        service.pipe = lambda *a, **k: PROBS
        with patch.object(service, '_finbert_prob_score', side_effect=[(.7, .8), RuntimeError(), RuntimeError()]), patch.object(service, 'score_with_setfit', side_effect=[FB, RuntimeError()]):
            result = service.analyze(service.SentIn(texts=['One', 'Two', 'record surge']))
        self.assertEqual(result['samples'], [.7, .9, 2 / 3])
        self.assertEqual(result['sample_engines'], ['finbert', 'setfit_fallback', 'lexicon_fallback'])
        self.assertEqual(result['sample_model_versions'], ['ProsusAI/finbert', 'test-setfit', None])
        self.assertEqual(result['n'], 3)
        self.assertEqual(result['engine'], 'mixed')
        self.assertIsNone(result['model_version'])

    def test_http_health_and_ready_status_codes(self):
        from fastapi.testclient import TestClient
        with TestClient(service.app) as client:
            with patch.object(service, 'pipeline', side_effect=RuntimeError), patch.object(service, 'score_with_setfit', side_effect=RuntimeError):
                self.assertEqual(client.get('/healthz').status_code, 200)
                response = client.get('/readyz')
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()['status'], 'unavailable')
            with patch.object(service, 'score_with_setfit', return_value=FB):
                response = client.get('/readyz')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['status'], 'degraded')

    def test_readiness_rejects_invalid_finbert_probabilities(self):
        invalid = [[], [{'label': 'LABEL_0', 'score': 1.0}],
                   [{'label': 'positive', 'score': float('nan')}],
                   [{'label': 'positive', 'score': 2.0}, {'label': 'negative', 'score': -1.0}, {'label': 'neutral', 'score': 0.0}]]
        for output in invalid:
            with self.subTest(output=output):
                service.pipe_disabled_reason = None
                service.pipe = lambda *a, **k: output
                with patch.object(service, 'score_with_setfit', side_effect=RuntimeError):
                    result = service.readyz()
                self.assertEqual(getattr(result, 'status_code', 200), 503)

    def test_readiness_rejects_invalid_setfit_probabilities(self):
        service.pipe_disabled_reason = 'test_primary_unavailable'
        invalid = [[float('nan')] * 3, [0.0] * 3, [2.0, -1.0, 0.0], [.5, .5]]
        for output in invalid:
            with self.subTest(output=output):
                model = types.SimpleNamespace(labels=['positive', 'negative', 'neutral'], predict_proba=lambda texts: [output])
                with patch.object(fallback, 'get_setfit_model', return_value=model):
                    result = service.readyz()
                self.assertEqual(getattr(result, 'status_code', 200), 503)

    def test_valid_setfit_readiness_uses_real_helper(self):
        service.pipe_disabled_reason = 'test_primary_unavailable'
        model = types.SimpleNamespace(labels=['positive', 'negative', 'neutral'], predict_proba=lambda texts: [[.9, .05, .05]])
        with patch.object(fallback, 'get_setfit_model', return_value=model):
            result = service.readyz()
        self.assertEqual(result['status'], 'degraded')
        self.assertEqual(result['model_version'], fallback.MODEL_VERSION)

if __name__ == '__main__':
    unittest.main(verbosity=2)
