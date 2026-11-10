"""Offline contracts for the staged ARM-only acceptance machinery."""
import ast, importlib.util, json, struct, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', ROOT / 'scripts/arm-locked-install.py')
installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)

class Contracts(unittest.TestCase):
    def test_scripts_parse(self):
        for path in (ROOT / 'scripts').glob('arm-*.py'): ast.parse(path.read_text(encoding='utf-8-sig'))
    def test_lock_hashes_and_conflicts(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'lock'; p.write_text('example==1.0 \\\n --hash=sha256:' + 'a'*64 + '\n')
            self.assertEqual(installer.read_locks([p])['example'][0], '1.0')
            q = Path(d) / 'other'; q.write_text('example==2.0 --hash=sha256:' + 'b'*64)
            with self.assertRaises(ValueError): installer.read_locks([p,q])
    def test_missing_hash_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'lock'; p.write_text('example==1.0')
            with self.assertRaises(ValueError): installer.read_locks([p])
    def test_source_url_allowlist(self):
        installer.trusted_url('https://files.pythonhosted.org/packages/a.whl')
        for url in ['http://files.pythonhosted.org/a', 'https://evil.test/a', 'https://u@files.pythonhosted.org/a', 'https://files.pythonhosted.org:444/a']:
            with self.assertRaises(ValueError): installer.trusted_url(url)
    def test_zip_sizes_include_filesystem_overhead(self):
        record = struct.pack('<4s6H3L5H2L', b'PK\x01\x02',20,20,0,8,0,0,0,20,100,1,0,0,0,0,0,0) + b'x'
        self.assertEqual(installer.directory_sizes(record), 4196)
        with self.assertRaises(ValueError): installer.directory_sizes(record[:-1])
    def test_malformed_zip_rejected(self):
        for data in [b'x',b'0'*46]:
            with self.assertRaises(ValueError): installer.directory_sizes(data)
    def test_budget_includes_models_reserve_and_one_download(self):
        self.assertEqual(installer.budget([{'expanded':100,'compressed':30},{'expanded':200,'compressed':50}]),375+50+4*1024**3)
    def test_no_install_on_non_native_host(self):
        with patch.object(installer.platform,'system',return_value='Linux'), patch.object(installer.platform,'machine',return_value='x86_64'), patch('sys.argv',['installer','--work','unused','unused.lock']):
            with self.assertRaisesRegex(RuntimeError,'aarch64'): installer.main()
    def test_unbounded_range_response_rejected(self):
        class Response:
            status=200; headers={}; url='https://files.pythonhosted.org/a.whl'
            def __enter__(self): return self
            def __exit__(self,*a): pass
            def read(self,n): raise AssertionError('must reject before body')
        with patch.object(installer,'urlopen',return_value=Response()):
            with self.assertRaises(ValueError): installer.range_bytes(Response.url,0,4,10)
    def test_actual_existing_locks_parse(self):
        repo = Path('/repo') if Path('/repo').exists() else ROOT
        if not repo.exists(): self.skipTest('repository fixture not supplied')
        pins=installer.read_locks([repo/'requirements.build.lock.txt',repo/'requirements.sentiment.lock.txt'])
        self.assertGreater(len(pins),100); self.assertEqual(pins['torch'][0],'2.14.1')
    def test_pinned_model_digest_rejects_other_bytes(self):
        model_spec=importlib.util.spec_from_file_location('native_model',ROOT/'scripts/arm-model-runtime.py')
        model=importlib.util.module_from_spec(model_spec); model_spec.loader.exec_module(model)
        with tempfile.TemporaryDirectory() as d:
            file=Path(d)/'artifact'; file.write_bytes(b'not the approved model')
            for name in ['model.safetensors','config.json']:
                with self.assertRaises(RuntimeError): model.bind_finbert(name,file)
    def test_disk_failure_prevents_install(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as d:
            with patch.object(installer.platform,'system',return_value='Linux'), patch.object(installer.platform,'machine',return_value='aarch64'), patch('sys.prefix','/isolated-venv'), patch('sys.argv',['installer','--work',str(Path(d)/'work'),'lock']), patch.object(installer,'read_locks',return_value={'x':('1',['a'*64])}), patch.object(installer,'choose_wheel',return_value={'name':'x','version':'1','filename':'x.whl','sha256':'a'*64,'compressed':100,'expanded':200}), patch.object(installer.shutil,'disk_usage',return_value=SimpleNamespace(free=1)), patch.object(installer,'install') as install, patch.object(Path,'read_bytes',return_value=b'lock'):
                with self.assertRaisesRegex(RuntimeError,'disk budget'): installer.main()
                install.assert_not_called()
    def test_unsafe_wheel_filename_prevents_download(self):
        with tempfile.TemporaryDirectory() as d, patch.object(installer,'urlopen') as request:
            with self.assertRaises(ValueError): installer.install({'filename':'../escape.whl'},Path(d))
            request.assert_not_called()
    def test_workflow_contract(self):
        import yaml
        w=yaml.load((ROOT/'.github/workflows/native-arm-acceptance.yml').read_text(encoding='utf-8-sig'),Loader=yaml.BaseLoader)
        self.assertIn('pull_request',w['on']); self.assertNotIn('pull_request_target',w['on'])
        self.assertEqual(w['permissions'],{'contents':'read'})
        self.assertEqual(len(w['jobs']),2)
        for job in w['jobs'].values():
            self.assertEqual(job['runs-on'],'ubuntu-24.04-arm')
            self.assertIn('private == false',job['if'])
            checkout=job['steps'][0]
            self.assertIn('head.sha',checkout['with']['ref'])
            self.assertEqual(checkout['with']['persist-credentials'],'false')
        text=json.dumps(w)
        for forbidden in ['--ignore-unfixed','pull_request_target','secrets.','upload-artifact','setup-qemu','docker push','sudo rm','docker system prune']:
            self.assertNotIn(forbidden,text)
    def test_shell_syntax(self):
        import yaml, subprocess
        w=yaml.load((ROOT/'.github/workflows/native-arm-acceptance.yml').read_text(encoding='utf-8-sig'),Loader=yaml.BaseLoader)
        for job in w['jobs'].values():
            for step in job['steps']:
                if 'run' in step: subprocess.run(['bash','-n'],input=step['run'],text=True,check=True)

    def test_source_complement_identity_and_rejections(self):
        import copy
        spec=importlib.util.spec_from_file_location('source_sbom',ROOT/'scripts/caddy-source-sbom.py')
        helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
        manifest=json.loads((ROOT/'deploy/private/caddy/certificates-backport.json').read_text())
        base={'components':[{'name':'./certificates-midas'},{'name':'github.com/go-jose/go-jose/v4','version':'v4.1.9'}]}
        result=helper.supplement(copy.deepcopy(base),manifest,'a'*64)
        self.assertEqual(result['components'][-1]['purl'],'pkg:golang/github.com/smallstep/certificates@v0.30.2')
        helper.verify_scan({'Results':[{'Packages':[{'Name':'github.com/smallstep/certificates','Version':'v0.30.2'}]}]})
        with self.assertRaises(ValueError):helper.verify_scan({'Results':[]})
        with self.assertRaises(ValueError):helper.verify_scan({'Results':[{'Packages':[{'Name':'github.com/smallstep/certificates','Version':'v0.30.2'}],'Vulnerabilities':[{'Severity':'HIGH'}]}]})
        for bad in [{'components':[]},{'components':base['components']+[{'name':'github.com/go-jose/go-jose/v3'}]},result]:
            with self.assertRaises(ValueError):helper.supplement(copy.deepcopy(bad),manifest,'a'*64)
    def test_future_scan_preserves_source_component_coverage(self):
        workflow=(ROOT/'.github/workflows/native-arm-acceptance.yml').read_text()
        self.assertIn('scripts/caddy-source-sbom.py',workflow)
        self.assertIn('--list-all-pkgs --scanners vuln --severity HIGH,CRITICAL --exit-code 1',workflow)
        self.assertIn('scripts/caddy-source-sbom.py --verify-scan',workflow)
        gate=(ROOT/'scripts/arm-gate-build.py').read_text()
        self.assertIn("len(modules) != 146",gate)
        self.assertIn("'github.com/go-jose/go-jose/v3' in modules",gate)
    def test_backport_contract_is_bounded(self):
        manifest=json.loads((ROOT/'deploy/private/caddy/certificates-backport.json').read_text())
        self.assertEqual(len(manifest['files']),25)
        for entry in manifest['files']:
            self.assertEqual(len(entry['before_sha256']),64)
            self.assertEqual(len(entry['after_sha256']),64)
            self.assertNotIn('..',Path(entry['path']).parts)
        self.assertEqual(manifest['upstream_version'],'v0.30.2')
        docker=(ROOT/'deploy/private/caddy/Dockerfile').read_text()
        self.assertIn(manifest['upstream_zip_sha256'],docker)
        self.assertIn('--network=none go build -mod=readonly',docker)
if __name__=='__main__': unittest.main()
