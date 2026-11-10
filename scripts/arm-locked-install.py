"""Disk-gated exact-lock installer for a fresh native ARM CI environment only."""
import argparse, hashlib, json, os, platform, re, shutil, struct, subprocess, sys
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
try:
    from pip._vendor.packaging.tags import sys_tags
    from pip._vendor.packaging.utils import parse_wheel_filename
except ModuleNotFoundError:
    from packaging.tags import sys_tags
    from packaging.utils import parse_wheel_filename

GIB = 1024 ** 3
RESERVE = 2 * GIB
MODEL_BUDGET = 2 * GIB

def read_locks(paths):
    out = {}
    for path in paths:
        text = Path(path).read_text().replace('\\\n', ' ')
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith('#'): continue
            m = re.fullmatch(r'([A-Za-z0-9_.-]+)==([^\s;]+)\s+((?:--hash=sha256:[a-f0-9]{64}\s*)+)', line)
            if not m: raise ValueError('Unsupported lock syntax: ' + line[:70])
            name = re.sub(r'[-_.]+', '-', m[1]).lower()
            value = (m[2], sorted(set(re.findall(r'sha256:([a-f0-9]{64})', m[3]))))
            if name in out and out[name] != value: raise ValueError('Conflicting lock: ' + name)
            out[name] = value
    return out

def trusted_url(url):
    u = urlparse(url)
    if u.scheme != 'https' or u.hostname != 'files.pythonhosted.org' or u.username or u.port:
        raise ValueError('Unexpected wheel source')

def range_bytes(url, start, end, total):
    trusted_url(url)
    req = Request(url, headers={'Range': f'bytes={start}-{end}', 'Accept-Encoding': 'identity'})
    with urlopen(req, timeout=30) as response:
        trusted_url(response.url)
        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{total}':
            raise ValueError('Wheel host did not honor bounded Range request')
        data = response.read(end - start + 2)
    if len(data) != end - start + 1: raise ValueError('Unexpected range length')
    return data

def directory_sizes(data):
    offset = size = entries = 0
    while offset < len(data):
        if len(data) - offset < 46: raise ValueError('Short ZIP directory')
        fields = struct.unpack_from('<4s6H3L5H2L', data, offset)
        if fields[0] != b'PK\x01\x02' or fields[9] == 0xffffffff or fields[13] != 0:
            raise ValueError('Unsupported ZIP directory')
        size += fields[9]; entries += 1
        offset += 46 + fields[10] + fields[11] + fields[12]
    if offset != len(data): raise ValueError('ZIP directory exceeds boundary')
    return size + entries * 4096

def expanded_size(url, total):
    tail = range_bytes(url, max(0, total - 65557), total - 1, total)
    at = tail.rfind(b'PK\x05\x06')
    if at < 0 or len(tail) - at < 22: raise ValueError('Missing ZIP end directory')
    fields = struct.unpack_from('<4s4H2LH', tail, at)
    if fields[1] or fields[2] or fields[3] != fields[4] or fields[4] == 65535 or at + 22 + fields[7] != len(tail):
        raise ValueError('Unsupported multidisk/ZIP64 wheel')
    length, offset = fields[5], fields[6]
    if not 0 < length <= 16 * 1024 * 1024 or offset + length > total: raise ValueError('Unbounded ZIP directory')
    return directory_sizes(range_bytes(url, offset, offset + length - 1, total))

def choose_wheel(name, version, hashes, tags):
    url = f'https://pypi.org/pypi/{name}/{version}/json'
    with urlopen(url, timeout=30) as response:
        raw = response.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024: raise ValueError('Metadata too large')
    files = json.loads(raw)['urls']; candidates = []
    for f in files:
        if f['packagetype'] != 'bdist_wheel' or f.get('yanked') or f['digests']['sha256'] not in hashes: continue
        _, _, _, wheel_tags = parse_wheel_filename(f['filename'])
        rank = min((tags[t] for t in wheel_tags if t in tags), default=None)
        if rank is not None: candidates.append((rank, f['filename'], f))
    if not candidates: raise ValueError('No compatible hash-locked wheel: ' + name)
    f = sorted(candidates, key=lambda c: c[:2])[0][2]
    trusted_url(f['url'])
    return dict(name=name, version=version, filename=f['filename'], url=f['url'], sha256=f['digests']['sha256'], compressed=f['size'], expanded=expanded_size(f['url'], f['size']))

def budget(wheels):
    # 25% installed/bytecode overhead + largest wheel download + model allowance + untouched reserve.
    return (sum(w['expanded'] for w in wheels) * 5 + 3) // 4 + max(w['compressed'] for w in wheels) + MODEL_BUDGET + RESERVE

def install(w, work):
    if Path(w['filename']).name != w['filename'] or '/' in w['filename'] or '\\' in w['filename']: raise ValueError('Unsafe wheel filename')
    target = work / w['filename']
    if target.exists(): raise ValueError('Refusing existing wheel output')
    digest = hashlib.sha256(); written = 0
    with urlopen(w['url'], timeout=30) as response, target.open('xb') as output:
        trusted_url(response.url)
        while chunk := response.read(1024 * 1024):
            written += len(chunk)
            if written > w['compressed'] or shutil.disk_usage(work).free < RESERVE + MODEL_BUDGET:
                raise RuntimeError('Download size/disk reserve breached')
            digest.update(chunk); output.write(chunk)
    if written != w['compressed'] or digest.hexdigest() != w['sha256']: raise ValueError('Wheel hash/size mismatch')
    req = work / 'current-wheel.txt'
    req.write_text(target.as_uri() + ' --hash=sha256:' + w['sha256'] + '\n')
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-index', '--no-cache-dir', '--no-deps', '--require-hashes', '--no-compile', '-r', str(req)], check=True)
    target.unlink(); req.unlink()  # only exact files created by this installer

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--work', required=True); parser.add_argument('locks', nargs='+'); args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() != 'aarch64': raise RuntimeError('Native Linux aarch64 required; no QEMU setup permitted')
    if sys.version_info[:2] != (3, 11) or sys.prefix == sys.base_prefix: raise RuntimeError('Isolated Python3.11 venv required')
    work = Path(args.work).resolve(); work.mkdir(exist_ok=False)
    tags = {tag: i for i, tag in enumerate(sys_tags())}
    wheels = [choose_wheel(n, v, h, tags) for n, (v, h) in read_locks(args.locks).items()]
    free = shutil.disk_usage(work).free; needed = budget(wheels)
    (work / 'disk-plan.json').write_text(json.dumps(dict(architecture=platform.machine(), freeBytes=free, requiredBytes=needed, reserveBytes=RESERVE, modelAllowanceBytes=MODEL_BUDGET, wheels=wheels), indent=2))
    print(json.dumps(dict(packages=len(wheels), freeBytes=free, requiredBytes=needed)), flush=True)
    for lock in args.locks: print(json.dumps(dict(lock=Path(lock).name, sha256=hashlib.sha256(Path(lock).read_bytes()).hexdigest())), flush=True)
    for wheel in wheels: print(json.dumps({k: wheel[k] for k in ['name', 'version', 'filename', 'sha256', 'compressed', 'expanded']}), flush=True)
    if free < needed: raise RuntimeError('Native wheel/model working set exceeds free-runner disk budget; no installation attempted')
    for i, wheel in enumerate(wheels):
        remaining = wheels[i:]
        if shutil.disk_usage(work).free < budget(remaining): raise RuntimeError('Disk admission failed before next package')
        install(wheel, work)
    subprocess.run([sys.executable, '-m', 'pip', 'check'], check=True)
    print('PASS exact-lock native environment; model/runtime validation is a separate required step')

if __name__ == '__main__': main()
