"""Pinned model preparation or actual offline native CPU runtime acceptance."""
import argparse, hashlib, json, math, os, platform, resource, runpy, shutil, socket, subprocess, time
from pathlib import Path

REVISION = '0bc2ac10dda6929bcb1f77ccc43c7ec5c424f031'
FILES = ['config.json', 'model.safetensors', 'special_tokens_map.json', 'tokenizer_config.json', 'vocab.txt']

def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        while chunk := source.read(1024 * 1024): digest.update(chunk)
    return digest.hexdigest()

def bind_repository_models(root):
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--', 'audit_logs/sentiment_audit/setfit_model_hpc_full', 'services/recommender_api/model.joblib'], cwd=root).decode().split('\0')
    count = 0
    for relative in filter(None, paths):
        path = root / relative
        committed = subprocess.check_output(['git', 'show', 'HEAD:' + relative], cwd=root)
        digest = sha256(path)
        if committed.startswith(b'version https://git-lfs.github.com/spec/v1'):
            expected = next(line.split(b':',1)[1].decode() for line in committed.splitlines() if line.startswith(b'oid sha256:'))
            if digest != expected: raise RuntimeError('Git LFS artifact mismatch: ' + relative)
        else:
            if hashlib.sha256(committed).hexdigest() != digest: raise RuntimeError('Git artifact mismatch: ' + relative)
        print(json.dumps(dict(artifact=relative, sha256=digest, bytes=path.stat().st_size)), flush=True)
        count += 1
    if count < 5: raise RuntimeError('Missing tracked model artifacts')

# Public Git object identities from the pinned official Hugging Face tree.
# Keep filenames and digest values in separate columns to avoid mistaking tokenizer
# filenames for API-token assignments in generic secret scanners.
FINBERT_GIT_BLOBS = dict(zip([FILES[0], *FILES[2:]], [
    'e3d6323dc93e170f3eef66cebb32dbaf4589aee0',
    'e7b0375001f109a6b8873d756ad4f7bbb15fbaa5',
    'cd79adc84d3c96daa03456853766c63141aef734',
    'fb140275c155a9c7c5a3b3e0e77a9e839594a938',
]))

def bind_finbert(name, path):
    digest = sha256(path)
    if name == 'model.safetensors':
        if digest != 'e5897858ff819aad7629b96ce521ae5477952d03634ef5dd30ed2d76357a9f00': raise RuntimeError('Pinned FinBERT weight hash mismatch')
    else:
        data = Path(path).read_bytes()
        git_blob = hashlib.sha1(('blob ' + str(len(data)) + '\0').encode() + data).hexdigest()
        if git_blob != FINBERT_GIT_BLOBS[name]: raise RuntimeError('Pinned FinBERT config hash mismatch')
    print(json.dumps(dict(model='ProsusAI/finbert', revision=REVISION, file=name, sha256=digest)), flush=True)

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('mode', choices=['prepare', 'test']); args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() != 'aarch64': raise RuntimeError('Native aarch64 required')
    if os.environ.get('LIVE_PROVIDERS') != '0': raise RuntimeError('Providers must remain off')
    for key in ['FINNHUB_TOKEN', 'FINNHUB_API_KEY', 'TIINGO_TOKEN', 'HF_TOKEN']:
        if os.environ.get(key): raise RuntimeError('No provider/model credentials permitted')
    root = Path(__file__).resolve().parents[1]
    bind_repository_models(root)
    if args.mode == 'prepare':
        from huggingface_hub import hf_hub_download, hf_hub_url, get_hf_file_metadata
        sizes = [get_hf_file_metadata(hf_hub_url('ProsusAI/finbert', f, revision=REVISION)).size for f in FILES]
        if any(s is None for s in sizes) or sum(sizes) > 1024**3: raise RuntimeError('Pinned model exceeds admitted 1GiB download budget')
        if shutil.disk_usage(os.environ['HF_HOME']).free < 4 * 1024**3: raise RuntimeError('Model allowance plus untouched reserve unavailable')
        for name in FILES:
            path = hf_hub_download('ProsusAI/finbert', name, revision=REVISION)
            bind_finbert(name, path)
        # Record the pinned revision as the cache reference used by the unchanged app's model name.
        cache = Path(os.environ['HF_HOME']) / 'hub/models--ProsusAI--finbert'
        refs = cache / 'refs'; refs.mkdir(exist_ok=True)
        (refs / 'main').write_text(REVISION)
        print('Prepared pinned FinBERT revision', REVISION, 'bytes', sum(sizes))
        return
    if os.environ.get('HF_HUB_OFFLINE') != '1' or os.environ.get('TRANSFORMERS_OFFLINE') != '1': raise RuntimeError('Offline model test required')
    cache = Path(os.environ['HF_HOME']) / 'hub/models--ProsusAI--finbert/snapshots' / REVISION
    for name in FILES: bind_finbert(name, cache / name)
    # Reject socket access outright during actual model/ASGI tests, not merely absent credentials.
    def denied(*args, **kwargs): raise RuntimeError('Native model acceptance must not contact network')
    socket.create_connection = denied
    socket.socket.connect = denied
    started = time.monotonic()
    runpy.run_path(str(root / 'scripts/sentiment-smoke.py'), run_name='__main__')
    from fastapi.testclient import TestClient
    from services.sentiment_api import app as sentiment
    with TestClient(sentiment.app) as client:
        assert client.get('/healthz').status_code == 200
        assert client.get('/readyz').json()['status'] == 'degraded'
        response = client.post('/api/sentiment', json={'texts': ['Synthetic revenue growth improved this quarter.']})
        assert response.status_code == 200 and response.json()['engine'] == 'setfit_fallback'
    from services.recommender_api import app as recommender
    with TestClient(recommender.app) as client:
        features = dict(sent_mean=.2, sent_std=.1, r_1m=.001, r_5m=.003, above_sma20=True, mins_since_news=5, rv20=.01, earnings_soon=False, liquidity_flag=True)
        response = client.post('/api/recommend', json=features)
        assert response.status_code == 200
        result = response.json()
        assert result['class'] and result['version'] and math.isfinite(result['confidence']) and 0 <= result['confidence'] <= 1
    print('Native runtime seconds', time.monotonic() - started, 'maxRSSKiB', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    print('PASS actual native FinBERT/SetFit/recommender inference and ASGI routes; not full Docker deployment acceptance')

if __name__ == '__main__': main()
