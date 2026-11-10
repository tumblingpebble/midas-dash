"""Conservative advisory identity for a clearly labeled local certificates backport.
The raw image SBOM is preserved. This complement is not an unmodified-module claim.
"""
import argparse, hashlib, json, sys
from pathlib import Path

def supplement(bom, manifest, manifest_hash):
    components=bom['components']
    local=[c for c in components if c['name']=='./certificates-midas']
    if len(local)!=1: raise ValueError('Expected exactly one transparent local certificates replacement')
    if any(c['name']=='github.com/go-jose/go-jose/v3' for c in components): raise ValueError('Vulnerable JOSE v3 remains in runtime SBOM')
    if not any(c['name']=='github.com/go-jose/go-jose/v4' and c.get('version')=='v4.1.9' for c in components): raise ValueError('Expected supported JOSE v4.1.9 runtime component')
    if manifest['upstream_module']!='github.com/smallstep/certificates' or manifest['upstream_version']!='v0.30.2': raise ValueError('Unexpected original source identity')
    if any(c.get('bom-ref')=='midas-conservative-certificates-original' for c in components): raise ValueError('Already supplemented')
    components.append({'bom-ref':'midas-conservative-certificates-original','type':'library','name':manifest['upstream_module'],'version':manifest['upstream_version'],'purl':'pkg:golang/github.com/smallstep/certificates@v0.30.2','properties':[
        {'name':'midas:scope','value':'Conservative original-source advisory identity for locally modified replacement; not an unmodified linked module'},
        {'name':'midas:upstream-commit','value':manifest['upstream_commit']},
        {'name':'midas:migration-commit','value':manifest['migration_commit']},
        {'name':'midas:backport-manifest-sha256','value':manifest_hash}]})
    return bom

def verify_scan(report):
    packages=[p for r in report.get('Results',[]) for p in r.get('Packages',[])]
    if not any(p.get('Name')=='github.com/smallstep/certificates' and p.get('Version')=='v0.30.2' for p in packages):
        raise ValueError('Scanner did not recognize conservative certificates source identity')
    if any(v.get('Severity') in ('HIGH','CRITICAL') for r in report.get('Results',[]) for v in r.get('Vulnerabilities',[])):
        raise ValueError('Strict source component scan contains HIGH/CRITICAL findings')
    print('Verified scanner inventory: github.com/smallstep/certificates@v0.30.2; no HIGH/CRITICAL findings')
def main():
    p=argparse.ArgumentParser();p.add_argument('raw_sbom',type=Path);p.add_argument('backport',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    raw=a.backport.read_bytes();h=hashlib.sha256(raw).hexdigest()
    result=supplement(json.loads(a.raw_sbom.read_text()),json.loads(raw),h)
    with a.output.open('x',encoding='utf-8') as f: json.dump(result,f,indent=2)
    print(json.dumps({'backport_sha256':h,'supplement_sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'component':'github.com/smallstep/certificates@v0.30.2','meaning':'conservative original-source identity, locally modified'}))
if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--verify-scan':verify_scan(json.loads(Path(sys.argv[2]).read_text()))
    else:main()