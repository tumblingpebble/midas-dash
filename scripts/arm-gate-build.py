"""Native small-image build with allowlisted tracked context and per-build disk gates."""
import json, os, platform, shutil, signal, subprocess, time
from pathlib import Path


def main():
    if platform.machine() != 'aarch64': raise RuntimeError('Native ARM host required')
    root = Path.cwd().resolve(); target = Path(os.environ['RUNNER_TEMP']) / 'midas-arm-context'
    target.mkdir(exist_ok=False)
    docker_root = Path(subprocess.check_output(['docker', 'info', '--format', '{{.DockerRootDir}}'], text=True).strip())
    if not docker_root.is_dir(): raise RuntimeError('Cannot monitor Docker data-root filesystem')
    def free_bytes(): return min(shutil.disk_usage(target).free, shutil.disk_usage(docker_root).free)

    paths = subprocess.check_output(['git', 'ls-files', '-z', '--', 'services', 'platform_app', 'requirements*.txt', '.dockerignore']).decode().split('\0')
    for relative in filter(None, paths):
        source = root / relative
        if source.is_symlink() or not source.resolve().is_relative_to(root): raise RuntimeError('Untrusted context path')
        if any(part in ['node_modules', 'dist', '__pycache__'] or part.startswith('.env') for part in Path(relative).parts): continue
        output = target / relative; output.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, output)
    builds = [
        ('midas-arm-gate', 6, ['docker', 'build', '-t', 'midas-arm-gate', 'deploy/private/caddy']),
        ('midas-arm-python', 3, ['docker', 'build', '-t', 'midas-arm-python', '-f', str(target / 'services/Dockerfile'), '--build-arg', 'REQ_FILE=requirements.base.txt', str(target)]),
        ('midas-arm-web', 3, ['docker', 'build', '-t', 'midas-arm-web', '-f', str(target / 'platform_app/Dockerfile'), str(target)]),
    ]
    for name, allowance_gib, command in builds:
        free = free_bytes(); minimum = (allowance_gib + 2) * 1024**3
        print(json.dumps(dict(build=name, freeBytes=free, admissionBytes=minimum)), flush=True)
        if free < minimum: raise RuntimeError('Insufficient bounded build headroom; do not prune runner tools/caches')
        # Allowances are admission heuristics, not measured ARM peak guarantees.
        process = subprocess.Popen(command, start_new_session=True)
        deadline = time.monotonic() + 900
        try:
            while process.poll() is None:
                if free_bytes() < 2 * 1024**3 or time.monotonic() > deadline:
                    raise RuntimeError('Active build disk reserve/time limit reached; cancelling owned build')
                time.sleep(1)
            if process.returncode: raise subprocess.CalledProcessError(process.returncode, command)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGINT)
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL); process.wait()

        architecture = subprocess.check_output(['docker', 'image', 'inspect', name, '--format', '{{.Architecture}}'], text=True).strip()
        if architecture != 'arm64': raise RuntimeError('Image is not ARM64')
        if free_bytes() < 2 * 1024**3: raise RuntimeError('Post-build reserve breached; no further builds')
    info = subprocess.check_output(['docker', 'run', '--rm', '--network', 'none', 'midas-arm-gate', 'caddy', 'build-info'], text=True)
    pins = {}
    for line in Path('deploy/private/caddy/go.mod').read_text().splitlines():
        parts = line.strip().removeprefix('require ').split()
        if len(parts) >= 2 and parts[1].startswith('v'): pins[parts[0]] = parts[1]
    modules = {}; replacements = []; previous = None
    for line in info.splitlines():
        parts = line.strip().split()
        if parts and parts[0] == '=>':
            replacements.append((previous, parts[1:])); continue
        if len(parts) >= 3 and parts[0] == 'dep':
            previous=parts[1]; modules[previous] = parts[2]
    if replacements != [('github.com/smallstep/certificates', ['./certificates-midas', '(devel)'])]: raise RuntimeError('Unexpected local replacement identity')
    if len(modules) != 146 or 'github.com/go-jose/go-jose/v3' in modules or modules.get('github.com/go-jose/go-jose/v4') != 'v4.1.9' or modules.get('golang.org/x/net') != 'v0.62.0': raise RuntimeError('Unexpected repaired module map')
    for name, version in modules.items():
        if pins.get(name) != version: raise RuntimeError('Module pin mismatch: ' + name)
    print(info)
    image = subprocess.check_output(['docker', 'image', 'inspect', 'midas-arm-gate', '--format', '{{.Id}}'], text=True).strip()
    with open(os.environ['GITHUB_ENV'], 'a') as output: output.write('MIDAS_TEST_CADDY_IMAGE=' + image + '\n')

if __name__ == '__main__': main()
