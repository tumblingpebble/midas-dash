import assert from "node:assert/strict";
import * as fs from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const repo=resolve(process.env.MIDAS_TEST_REPO || fileURLToPath(new URL("..",import.meta.url)));
const candidate=resolve(process.env.MIDAS_TEST_CANDIDATE || repo);
if(!process.env.MIDAS_TEST_EVIDENCE)throw Error("Supply a fresh evidence directory");
const work=fs.mkdtempSync(join(resolve(process.env.MIDAS_TEST_EVIDENCE),"private-smoke-"));
const frontend=join(repo,"platform_app"),req=createRequire(join(frontend,"package.json")),esbuild=req("esbuild");
const caddy=process.env.MIDAS_TEST_CADDY_IMAGE;
if(!/^sha256:[a-f0-9]{64}$/.test(caddy || ""))throw Error("Supply the exact locally built repaired Caddy image ID");
const python=process.env.MIDAS_TEST_PYTHON_IMAGE,web=process.env.MIDAS_TEST_WEB_IMAGE;
if(!python||!web)throw Error("Supply existing Python and nginx web image references");
const id="midas-private-"+process.pid+"-"+Date.now(),network=id+"-net",gate=id+"-gate",app=id+"-web",echo=id+"-echo";
const owned=[],checks=[];
function check(name,fn){fn();checks.push(name);console.log("PASS "+name);}
function docker(args,{input,allowFailure=false}={}){
 const r=spawnSync("docker",args,{encoding:"utf8",input,maxBuffer:8*1024*1024,timeout:120000});
 if(!allowFailure&&(r.error||r.status!==0))throw Error("docker "+args[0]+" failed: "+(r.error?.message||r.stderr));
 return r;
}
const overrides=new Map(["src/lib/browserStorage.ts","src/pages/HistoryPage.tsx"].map(p=>[resolve(frontend,p),fs.readFileSync(join(candidate,"platform_app",p),"utf8")]));
const sourcePlugin={name:"reviewed-private-source",setup(b){b.onLoad({filter:/\.(ts|tsx)$/},a=>overrides.has(resolve(a.path))?{contents:overrides.get(resolve(a.path)),loader:a.path.endsWith("tsx")?"tsx":"ts"}:null);}};
async function loadStorage(privateMode){
 const r=await esbuild.build({absWorkingDir:frontend,stdin:{contents:"export {browserStorage,privateAccessMode} from './src/lib/browserStorage'; export {HistoryPage} from './src/pages/HistoryPage'; export {MemoryRouter} from 'react-router-dom'; export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';",resolveDir:frontend,sourcefile:"private-test.tsx"},write:false,bundle:true,platform:"node",format:"cjs",jsx:"automatic",plugins:[sourcePlugin],define:{"import.meta.env":JSON.stringify({VITE_PRIVATE_ACCESS:privateMode?"1":"0",VITE_API_BASE_URL:""})},logLevel:"silent"});
 const module={exports:{}};new Function("module","exports","require",r.outputFiles[0].text)(module,module.exports,req);return module.exports;
}
const oldStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
const durable=new Map([["midas_dash_history_v1","prior-owner-history"],["midas_dash_last_run_v1","prior-owner-run"]]),before=JSON.stringify([...durable]);let touches=0;
Object.defineProperty(globalThis,"localStorage",{configurable:true,get(){touches++;throw Error("Private build touched durable storage");}});
try{
 const s=await loadStorage(true);
 check("private build ignores saved history and last run",()=>{assert.equal(s.privateAccessMode,true);assert.equal(s.browserStorage.getItem("midas_dash_history_v1"),null);assert.equal(s.browserStorage.getItem("midas_dash_last_run_v1"),null);});
 check("private page supports memory writes merges and clears",()=>{s.browserStorage.setJson("midas_dash_history_v1",[1]);assert.equal(s.browserStorage.mergeItem("midas_dash_history_v1","[2]",(a,b)=>JSON.stringify([...JSON.parse(a),...JSON.parse(b||"[]")])),"[2,1]");s.browserStorage.removeItem("midas_dash_history_v1");assert.equal(s.browserStorage.getItem("midas_dash_history_v1"),null);s.browserStorage.setJson("midas_dash_last_run_v1",{test:"synthetic"});assert.equal(s.browserStorage.getItem("midas_dash_last_run_v1"),'{"test":"synthetic"}');});
 check("private History JSX explains page-memory behavior",()=>assert.match(s.renderToStaticMarkup(s.createElement(s.MemoryRouter,null,s.createElement(s.HistoryPage))),/Previously saved browser history is not loaded or deleted/));
 const fresh=await loadStorage(true);
 check("new page starts empty without touching or erasing durable bytes",()=>{assert.equal(fresh.browserStorage.getItem("midas_dash_last_run_v1"),null);assert.equal(touches,0);assert.equal(JSON.stringify([...durable]),before);});
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:k=>durable.get(k)??null,setItem:(k,v)=>durable.set(k,v),removeItem:k=>durable.delete(k)}});
 const normal=await loadStorage(false);
 check("ordinary build retains persistence",()=>{assert.equal(normal.browserStorage.getItem("midas_dash_last_run_v1"),"prior-owner-run");normal.browserStorage.setItem("test-normal","saved");assert.equal(durable.get("test-normal"),"saved");normal.browserStorage.removeItem("test-normal");});
}finally{if(oldStorage)Object.defineProperty(globalThis,"localStorage",oldStorage);else delete globalThis.localStorage;await esbuild.stop();}
const dist=join(work,"private-dist"),emptyEnv=join(work,"empty-env");fs.mkdirSync(emptyEnv);
const {build}=await import(pathToFileURL(req.resolve("vite")).href);
const {default:react}=await import(pathToFileURL(req.resolve("@vitejs/plugin-react")).href);
const {default:tailwind}=await import(pathToFileURL(req.resolve("@tailwindcss/vite")).href);
await build({root:frontend,configFile:false,envDir:emptyEnv,logLevel:"warn",plugins:[{name:"reviewed-private-source",enforce:"pre",load(id){return overrides.get(resolve(id));}},react(),tailwind()],define:{"import.meta.env.VITE_PRIVATE_ACCESS":'"1"',"import.meta.env.VITE_API_BASE_URL":'""'},build:{outDir:dist,emptyOutDir:false}});
check("private frontend builds without dotenv or source changes",()=>assert.ok(fs.existsSync(join(dist,"index.html"))));
const authDir=join(work,"auth");fs.mkdirSync(authDir);const authFile=join(authDir,"users.caddy");
// Deliberately public test-only fixture credentials, never operational accounts.
const fixturePassword="MIDAS-synthetic-test-only-not-a-secret";
const hash=docker(["run","--rm","--network","none",caddy,"caddy","hash-password","--plaintext",fixturePassword]).stdout.trim();
fs.writeFileSync(authFile,"fixture_alice "+hash+"\nfixture_bob "+hash+"\n",{flag:"wx"});
const configFile=join(work,"Caddyfile");
fs.writeFileSync(configFile,"{\n local_certs\n skip_install_trust\n}\n"+fs.readFileSync(join(candidate,"deploy/private/Caddyfile"),"utf8"),{flag:"wx"});
const echoFile=join(work,"echo.py");
fs.writeFileSync(echoFile,[
"from http.server import BaseHTTPRequestHandler,HTTPServer","import json","class H(BaseHTTPRequestHandler):"," def do_GET(self):",
"  body=json.dumps({'path':self.path,'authorization':self.headers.get('Authorization'),'proxy_authorization':self.headers.get('Proxy-Authorization'),'forged_user':self.headers.get('X-Forwarded-User')}).encode()",
"  self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Cache-Control','public, max-age=3600'); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Credentials','true'); self.end_headers(); self.wfile.write(body)",
" def log_message(self,*a): pass","HTTPServer(('0.0.0.0',8015),H).serve_forever()"].join("\n"),{flag:"wx"});
fs.writeFileSync(join(work,"requests.py"),[
"import sys,json,ssl,http.client,base64","spec=json.loads(sys.argv[1])","context=ssl.create_default_context(cafile='/test/root.crt')","out=[]","for item in spec:",
" headers=item.get('headers',{})"," if item.get('user'):","  headers['Authorization']='Basic '+base64.b64encode((item['user']+':'+item.get('password','MIDAS-synthetic-test-only-not-a-secret')).encode()).decode()",
" conn=http.client.HTTPSConnection('private.test',443,context=context,timeout=10) if not item.get('http') else http.client.HTTPConnection('private.test',80,timeout=10)",
" conn.request(item.get('method','GET'),item['path'],headers=headers)"," res=conn.getresponse()"," out.append({'status':res.status,'headers':dict(res.getheaders()),'body':res.read().decode(errors='replace')})"," conn.close()","print(json.dumps(out))"].join("\n"),{flag:"wx"});
function request(spec){return JSON.parse(docker(["run","--rm","--network",network,"--mount","type=bind,source="+work+",target=/test,readonly",python,"python","/test/requests.py",JSON.stringify(spec)]).stdout);}
function launch(name,args){owned.push(name);docker(["run","-d","--name",name,...args]);}
const mount=(source,target)=>["--mount","type=bind,source="+source+",target="+target+",readonly"];
let networkCreated=false, completed=false;
try{
 docker(["network","create","--internal",network]);networkCreated=true;
 launch(echo,["--network",network,"--network-alias","gateway_api",...mount(echoFile,"/echo.py"),python,"python","/echo.py"]);
 launch(app,["--network",network,"--network-alias","midas_dash",...mount(dist,"/usr/share/nginx/html"),...mount(join(repo,"platform_app/nginx.compose.conf"),"/etc/nginx/conf.d/default.conf"),web]);
 launch(gate,["--network",network,"--network-alias","private.test","-e","MIDAS_PRIVATE_HOST=private.test",...mount(configFile,"/etc/caddy/Caddyfile"),...mount(authDir,"/run/midas-auth"),...mount(join(candidate,"deploy/private/private-entrypoint.sh"),"/etc/caddy/private-entrypoint.sh"),"--entrypoint","/bin/sh",caddy,"/etc/caddy/private-entrypoint.sh"]);
 let ready=false;
 for(let i=0;i<30;i++){const r=docker(["cp",gate+":/data/caddy/pki/authorities/local/root.crt",join(work,"root.crt")],{allowFailure:true});if(r.status===0){try{if(request([{path:"/",user:"fixture_alice"}])[0].status===200){ready=true;break;}}catch{}}await new Promise(r=>setTimeout(r,500));}
 assert.ok(ready,"Gate not ready");
 for(const p of ["/","/history","/assets/missing.js","/api/run?ticker=TEST","/healthz","/%61pi/run?ticker=TEST","//api/run","/api/../history"]){
  check("anonymous/wrong-password denied: "+p,()=>assert.deepEqual(request([{path:p},{path:p,user:"fixture_alice",password:"wrong"}]).map(x=>x.status),[401,401]));
 }
 check("reviewer reaches real private frontend deep link",()=>{const r=request([{path:"/history",user:"fixture_alice"}])[0];assert.equal(r.status,200);assert.match(r.body,/<html/);assert.equal(r.headers["Cache-Control"],"no-store");});
 check("API strips credentials forged identity and upstream CORS",()=>{const r=request([{path:"/api/run?ticker=TEST",user:"fixture_alice",headers:{"Proxy-Authorization":"fixture","X-Forwarded-User":"forged"}}])[0];assert.equal(r.status,200);assert.equal(r.headers["Cache-Control"],"no-store");const b=JSON.parse(r.body);assert.equal(b.authorization,null);assert.equal(b.proxy_authorization,null);assert.equal(b.forged_user,null);assert.ok(!Object.keys(r.headers).some(k=>k.toLowerCase().startsWith("access-control-allow")));});
 check("HTTP redirects without app data or auth challenge",()=>{const r=request([{path:"/api/run",http:true}])[0];assert.equal(r.status,308);assert.match(r.headers.Location,/^https:/);assert.ok(!r.headers["WWW-Authenticate"]);assert.ok(!r.body.includes("authorization"));});
 check("cross-site API denied; same-origin API and CV navigation work",()=>assert.deepEqual(request([{path:"/api/run",user:"fixture_alice",headers:{"Sec-Fetch-Site":"cross-site"}},{path:"/%61pi/run",user:"fixture_alice",headers:{Origin:"https://other.test"}},{path:"/api/run",user:"fixture_alice",headers:{Origin:"https://private.test","Sec-Fetch-Site":"same-origin"}},{path:"/",user:"fixture_alice",headers:{"Sec-Fetch-Site":"cross-site"}}]).map(x=>x.status),[403,403,200,200]));
 check("authenticated TLS negotiates HTTP/2 and still strips credentials",()=>{
  const client=docker(["run","--rm","--network","none",python,"curl","--version"]).stdout;assert.match(client,/HTTP2/);
  const response=docker(["run","--rm","--network",network,...mount(work,"/test"),python,"curl","--fail","--silent","--show-error","--cacert","/test/root.crt","--http2","--user","fixture_alice:"+fixturePassword,"--write-out","\n%{http_version}","https://private.test/api/run?ticker=TEST"]).stdout;
  const lines=response.trim().split("\n");assert.equal(lines.pop(),"2");const body=JSON.parse(lines.join("\n"));assert.equal(body.authorization,null);assert.equal(body.proxy_authorization,null);
 });
 fs.writeFileSync(join(authDir,"next"),"fixture_bob "+hash+"\n");fs.renameSync(join(authDir,"next"),authFile);
 docker(["exec",gate,"caddy","reload","--config","/etc/caddy/Caddyfile"]);
 check("successful reload revokes one reviewer retaining another",()=>assert.deepEqual(request([{path:"/api/run",user:"fixture_alice"},{path:"/api/run",user:"fixture_bob"}]).map(x=>x.status),[401,200]));
 fs.writeFileSync(authFile,"fixture_bob not-a-valid-password-hash\n");
 check("invalid reload fails and leaves previous policy active",()=>{assert.notEqual(docker(["exec",gate,"caddy","reload","--config","/etc/caddy/Caddyfile"],{allowFailure:true}).status,0);assert.equal(request([{path:"/api/run",user:"fixture_bob"}])[0].status,200);});
 fs.writeFileSync(authFile,"");docker(["exec",gate,"caddy","reload","--config","/etc/caddy/Caddyfile"]);
 check("empty auth file denies everyone",()=>assert.equal(request([{path:"/",user:"fixture_bob"}])[0].status,401));
 fs.renameSync(authFile,join(authDir,"removed"));
 const validate=host=>docker(["run","--rm","--network","none","-e","MIDAS_PRIVATE_HOST="+host,...mount(configFile,"/etc/caddy/Caddyfile"),...mount(authDir,"/run/midas-auth"),caddy,"caddy","validate","--config","/etc/caddy/Caddyfile"],{allowFailure:true});
 check("missing auth file fails closed",()=>assert.notEqual(validate("private.test").status,0));
 fs.renameSync(join(authDir,"removed"),authFile);fs.writeFileSync(authFile,"fixture_bob "+hash+"\n");
 check("startup guard rejects schemes ports paths and multiline hostnames",()=>{for(const host of ["http://private.test","private.test:443","../private.test","private.test\ninjected",""]){const r=docker(["run","--rm","--network","none","-e","MIDAS_PRIVATE_HOST="+host,...mount(join(candidate,"deploy/private/private-entrypoint.sh"),"/guard"),"--entrypoint","/bin/sh",caddy,"/guard"],{allowFailure:true});assert.equal(r.status,78);assert.match(r.stderr,/DNS hostname/);}});
 check("all runtime test containers have zero host port bindings",()=>{for(const n of [gate,app,echo])assert.deepEqual(JSON.parse(docker(["inspect",n,"--format","{{json .HostConfig.PortBindings}}"]).stdout),{});});
 const emptyFile=join(work,"empty.env");fs.writeFileSync(emptyFile,"",{flag:"wx"});
 const oldHost=process.env.MIDAS_PRIVATE_HOST,oldAuth=process.env.MIDAS_PRIVATE_AUTH_DIR;process.env.MIDAS_PRIVATE_HOST="private.test";process.env.MIDAS_PRIVATE_AUTH_DIR=authDir;
 try{
  const cfg=JSON.parse(docker(["compose","--env-file",emptyFile,"-f",join(candidate,"docker-compose.private.yml"),"config","--format","json"]).stdout);
  check("standalone profile isolates ports fixes providers off and builds private frontend",()=>{for(const [n,s] of Object.entries(cfg.services))if(n!=="private_gate")assert.equal(s.ports,undefined);assert.equal(cfg.services.private_gate.pull_policy,"build");assert.equal(cfg.services.private_gate.image,"midas-private-caddy:2.11.9-net0.62.0");assert.equal(cfg.services.private_gate.build.context.replaceAll("\\","/"),join(candidate,"deploy/private/caddy").replaceAll("\\","/"));assert.equal(cfg.services.private_gate.build.dockerfile,"Dockerfile");assert.equal(cfg.networks.backend.internal,true);assert.equal(cfg.services.context_api.environment.LIVE_PROVIDERS,"0");for(const k of ["FINNHUB_TOKEN","FINNHUB_API_KEY","TIINGO_TOKEN"])assert.equal(cfg.services.context_api.environment[k],"");assert.equal(cfg.services.midas_dash.build.args.VITE_PRIVATE_ACCESS,"1");assert.equal(cfg.services.midas_dash.build.args.VITE_API_BASE_URL,"");});
  delete process.env.MIDAS_PRIVATE_HOST;
  check("missing required hostname fails configuration",()=>assert.notEqual(docker(["compose","--env-file",emptyFile,"-f",join(candidate,"docker-compose.private.yml"),"config"],{allowFailure:true}).status,0));
 }finally{if(oldHost===undefined)delete process.env.MIDAS_PRIVATE_HOST;else process.env.MIDAS_PRIVATE_HOST=oldHost;if(oldAuth===undefined)delete process.env.MIDAS_PRIVATE_AUTH_DIR;else process.env.MIDAS_PRIVATE_AUTH_DIR=oldAuth;}
 completed=true;
}finally{
 const logLeaks=[];
 for(const n of owned) {
  const logs=docker(["logs",n],{allowFailure:true});
  const body=logs.stdout+logs.stderr;
  const forbidden=[fixturePassword,hash,...["fixture_alice","fixture_bob"].map(u=>Buffer.from(u+":"+fixturePassword).toString("base64"))];
  if(forbidden.some(value=>body.includes(value)))logLeaks.push(n);
  fs.writeFileSync(join(work,n+".log"),body,{flag:"wx"});
 }
 for(const n of owned.reverse())docker(["rm","-f",n],{allowFailure:true});
 if(networkCreated)docker(["network","rm",network],{allowFailure:true});
 const remainingContainers=docker(["ps","-a","--format","{{.Names}}"]).stdout.trim().split(/\r?\n/).filter(n=>owned.includes(n));
 const remainingNetworks=docker(["network","ls","--format","{{.Name}}"]).stdout.trim().split(/\r?\n/).filter(n=>n===network);
 const cleanupVerified=remainingContainers.length===0&&remainingNetworks.length===0;
 if(completed)check("gate and upstream logs contain no fixture credentials or hashes",()=>assert.deepEqual(logLeaks,[]));
 fs.writeFileSync(join(work,"result.json"),JSON.stringify({completed,checks,count:checks.length,work,cleanupVerified,remainingContainers,remainingNetworks,logLeaks,owned,network},null,2),{flag:"wx"});
 assert.ok(cleanupVerified,"Owned test resource cleanup incomplete");
}
console.log(JSON.stringify({passed:checks.length,evidence:work}));
