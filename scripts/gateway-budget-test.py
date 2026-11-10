"""Offline gateway budget regressions: 16 HTTP/resource + 2 defaults + 46 retry cases.

Run in the gateway image with PYTHONPATH=/app and production services available.
Only loopback fixtures and MockTransport are used; no provider calls or extra packages.
HTTP timings deliberately include scheduling headroom. Socket deadlines remain actual
wall-clock tests, while retry policy uses deterministic transport failures.
"""
import asyncio
import collections
import importlib
import json
import socket
import sys
import threading
import time
import unittest
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import httpx
import uvicorn
from services.gateway_api import app as appmod
from services.gateway_api import request_budget as budget

CTX={'features':{'sent_mean':0.1}, 'quote':{'last':0},'company_name':'TEST', 'sentiment':{'engine':'finbert','warning':None,'confidence':.8,'model_version':'fixture'},'ts':'2026-11-09T00:00:00Z','error':None}
REC={'class':'NO_ACTION','confidence':.7,'version':'fixture'}
state={'delays':{},'statuses':{},'drip':False}; counts=collections.Counter(); lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*a): pass
    def do_POST(self): self.do_GET()
    def do_GET(self):
        path=self.path.split('?')[0]
        if self.command=='POST': self.rfile.read(int(self.headers.get('content-length',0)))
        with lock: counts[path]+=1
        time.sleep(state['delays'].get(path,0))
        obj=CTX if path=='/api/features/v2' else REC if path=='/api/recommend' else {'text':'Fixture source','refs_numbers':[]} if path=='/api/one_liner' else {'fixture':True}
        data=json.dumps(obj).encode(); status=state['statuses'].get(path,200)
        if status==299: data=b'not json';status=200
        if state['drip']: data=b'{"x":1}'
        self.send_response(status); self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers()
        try:
            if state['drip']:
                for chunk in [b'{',b'"x"',b':',b'1',b'}']:
                    self.wfile.write(chunk);self.wfile.flush();time.sleep(.4)
            else: self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError): pass

def helper(path):
    return asyncio.run(appmod._get_json(URL+path))
receipts=[]
class Contract(unittest.TestCase):
    def setUp(self):
        time.sleep(.8) # settle abandoned fixture requests between independent cases
        counts.clear();state.update(delays={},statuses={},drip=False)
        appmod.TIMEOUT=2;appmod.RETRIES=2;appmod.DELAY=.005
        budget.REQUEST_BUDGET_S=8;budget.CONTEXT_BUDGET_S=4;budget.OPTIONAL_BUDGET_S=.12;budget.OPTIONS_BUDGET_S=.12
        budget.RESPONSE_RESERVE_S=.1
        self.started=time.monotonic()
    def tearDown(self): receipts.append({'test':self.id().split('.')[-1],'elapsed':round(time.monotonic()-self.started,4),'upstream_calls':dict(counts)})
    def test_slow_context_success_without_duplicate(self):
        appmod.TIMEOUT=.5
        state['delays']['/api/features/v2']=1
        r=httpx.get(BASE+'/api/run?ticker=TEST',timeout=5)
        self.assertEqual(r.status_code,200,r.text);self.assertEqual(counts['/api/features/v2'],1)
        self.assertEqual(r.json()['sentiment'],CTX['sentiment'])
    def test_read_timeout_never_replays(self):
        appmod.TIMEOUT=.5
        state['delays']['/slow']=1
        with self.assertRaises(Exception): helper('/slow')
        self.assertEqual(counts['/slow'],1)
    def test_post_timeout_never_replays(self):
        appmod.TIMEOUT=.5
        state['delays']['/slow']=1
        with self.assertRaises(Exception) as c:
            asyncio.run(appmod._post_json(URL+'/slow',{'fixture':True}))
        self.assertEqual(c.exception.status_code,502)
        self.assertTrue(c.exception.detail.startswith('POST '+URL+'/slow failed:'))
        self.assertEqual(counts['/slow'],1)
    def test_drip_body_total_deadline(self):
        appmod.TIMEOUT=.5
        state['drip']=True
        start=time.monotonic()
        with self.assertRaises(Exception):helper('/drip')
        self.assertLess(time.monotonic()-start,1.5)
        self.assertEqual(counts['/drip'],1)
    def test_retry_backoff_respects_total_budget(self):
        appmod.TIMEOUT=1;appmod.DELAY=2;state['statuses']['/bad']=503
        with self.assertRaises(Exception):helper('/bad')
        self.assertEqual(counts['/bad'],1)
    def test_status_429_and_400_fail_fast(self):
        for status in (429,400):
            state['statuses']['/bad']=status;counts.clear()
            with self.assertRaises(Exception) as c: helper('/bad')
            self.assertEqual(c.exception.status_code,502)
            self.assertTrue(c.exception.detail.startswith('GET '+URL+'/bad failed:'))
            self.assertEqual(counts['/bad'],1)
    def test_transient_status_retry_still_supported(self):
        state['statuses']['/bad']=503
        with self.assertRaises(Exception): helper('/bad')
        self.assertEqual(counts['/bad'],3)
    def test_malformed_json_no_retry(self):
        state['statuses']['/bad']=299
        with self.assertRaises(Exception): helper('/bad')
        self.assertEqual(counts['/bad'],1)
    def test_whole_request_budget(self):
        budget.REQUEST_BUDGET_S=1.5;budget.CONTEXT_BUDGET_S=1.4;budget.OPTIONAL_BUDGET_S=.1
        state['delays']={x:.9 for x in ['/api/features/v2','/api/recommend','/api/explain','/api/one_liner']}
        start=time.monotonic();r=httpx.get(BASE+'/api/run?ticker=TEST&explain=1',timeout=5);elapsed=time.monotonic()-start
        self.assertEqual(r.status_code,502);self.assertLess(elapsed,2.5)
    def test_near_deadline_optional_preserves_recommendation(self):
        budget.REQUEST_BUDGET_S=3;budget.CONTEXT_BUDGET_S=2
        budget.RESPONSE_RESERVE_S=.5;budget.OPTIONAL_BUDGET_S=3
        state['delays']={'/api/features/v2':.8,'/api/recommend':.5,'/api/explain':4,'/api/one_liner':4}
        r=httpx.get(BASE+'/api/run?ticker=TEST&explain=1',timeout=5)
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['recommendation'],REC)
        self.assertEqual(r.json()['explain'],{'error':'explain unavailable'})
        self.assertEqual(counts['/api/one_liner'],0)
    def test_optional_timeout_retains_truthful_partial_result(self):
        state['delays']['/api/explain']=.7;state['delays']['/api/one_liner']=.7
        r=httpx.get(BASE+'/api/run?ticker=TEST&explain=1',timeout=5)
        self.assertEqual(r.status_code,200,r.text);d=r.json()
        self.assertEqual(d['explain'],{'error':'explain unavailable'})
        self.assertEqual(d['sentiment'],CTX['sentiment']);self.assertEqual(d['recommendation'],REC)
        self.assertEqual(counts['/api/explain'],1);self.assertEqual(counts['/api/one_liner'],1)
    def test_disconnect_stops_downstream_dispatch(self):
        appmod.TIMEOUT=3;budget.CONTEXT_BUDGET_S=3
        state['delays']['/api/features/v2']=1
        s=socket.create_connection(('127.0.0.1',port));s.sendall(b'GET /api/run?ticker=TEST HTTP/1.1\r\nHost: localhost\r\n\r\n')
        deadline=time.monotonic()+3
        try:
            while not counts['/api/features/v2'] and time.monotonic()<deadline: time.sleep(.01)
        finally: s.close()
        time.sleep(1.3)
        self.assertEqual(counts['/api/features/v2'],1)
        self.assertEqual(counts['/api/recommend'],0)
    def test_missing_symbol_404(self):
        old=CTX.copy();CTX.update(company_name='TEST',quote={'last':0,'quality':'unknown'},error='404 not found',refs=[],top_headline=None)
        try:
            r=httpx.get(BASE+'/api/run?ticker=TEST',timeout=5)
            self.assertEqual(r.status_code,404);self.assertEqual(counts['/api/recommend'],0)
        finally:CTX.clear();CTX.update(old)
    def test_bounded_orphan_option_work(self):
        oldq=CTX['quote'];oldrec=REC.copy();oldfunc=appmod.get_option_chain_candidates
        CTX['quote']={'last':100};REC['class']='DEBIT_CALL'
        occupancy={'active':0,'peak':0,'calls':0}
        release=threading.Event()
        def options(**kwargs):
            with lock:
                occupancy['active']+=1;occupancy['calls']+=1;occupancy['peak']=max(occupancy['peak'],occupancy['active'])
            try:release.wait(10);return {'provider':'yfinance','available':False,'reason':'fixture','expirations':[],'selected_expiration':None,'candidates':[]}
            finally:
                with lock:occupancy['active']-=1
        appmod.get_option_chain_candidates=options
        results=[]
        def request(): results.append(httpx.get(BASE+'/api/run?ticker=TEST',timeout=5))
        try:
            ts=[threading.Thread(target=request) for _ in range(5)]
            for t in ts:t.start()
            for t in ts:t.join()
            self.assertEqual(len(results),5)
            self.assertTrue(all(r.status_code==200 for r in results),[r.text for r in results])
            self.assertLessEqual(occupancy['peak'],2);self.assertLessEqual(occupancy['calls'],2)
            self.assertTrue(all(r.json()['trade_plan']['option_chain_plan']['available'] is False for r in results))
            release.set()
            deadline=time.monotonic()+3
            while occupancy['active'] and time.monotonic()<deadline: time.sleep(.01)
            self.assertEqual(occupancy['active'],0)
        finally:release.set();CTX['quote']=oldq;REC.clear();REC.update(oldrec);appmod.get_option_chain_candidates=oldfunc
    def test_cancelled_option_keeps_occupancy(self):
        budget.OPTIONS_BUDGET_S=5
        release=threading.Event();entered=threading.Event();calls=[]
        def blocking():
            calls.append(1)
            if len(calls)==2:entered.set()
            release.wait(10)
        async def scenario():
            tasks=[asyncio.create_task(budget.optional_options(blocking)) for _ in range(2)]
            for _ in range(600):
                if entered.is_set():break
                await asyncio.sleep(.005)
            self.assertTrue(entered.is_set())
            for task in tasks:task.cancel()
            await asyncio.gather(*tasks,return_exceptions=True)
            with self.assertRaisesRegex(RuntimeError,'capacity unavailable'):
                await budget.optional_options(blocking)
            self.assertEqual(len(calls),2)
            release.set()
            for _ in range(300):
                if budget._option_slots._value==2: break
                await asyncio.sleep(.01)
            await budget.optional_options(lambda: 'released')
            token=budget._deadline.set(time.monotonic()-1)
            try:
                with self.assertRaisesRegex(RuntimeError,'budget exhausted'):
                    await budget.optional_options(blocking)
                self.assertEqual(len(calls),2)
            finally:budget._deadline.reset(token)
        try:asyncio.run(scenario())
        finally:release.set()
    def test_success_payload_matches_original(self):
        # Frozen output from the pre-budget gateway with identical fixtures.
        expected=json.loads((Path(__file__).with_name('gateway-budget-payload.json')).read_text())
        old_now=appmod.iso_now
        appmod.iso_now=lambda:'fixed'
        try:
            r=httpx.get(BASE+'/api/run?ticker=TEST&explain=1',timeout=10)
            self.assertEqual(r.status_code,200,r.text)
            actual=r.json()
            from datetime import datetime, timezone
            age=int((datetime.now(timezone.utc)-datetime.fromisoformat(CTX['ts'].replace('Z','+00:00'))).total_seconds())
            self.assertLessEqual(abs(actual['cache_age_seconds']-age),2)
            actual['cache_age_seconds']=expected['cache_age_seconds']
            self.assertEqual(actual,expected)
        finally:
            appmod.iso_now=old_now

class Defaults(unittest.TestCase):
    def setUp(self):
        counts.clear();state.update(delays={},statuses={},drip=False)
        importlib.reload(budget)
        importlib.reload(appmod)
        appmod.CTX_URL=URL;appmod.REC_URL=URL
        self.assertEqual((appmod.TIMEOUT,appmod.RETRIES,appmod.DELAY),(8,2,.25))
        self.assertEqual((budget.REQUEST_BUDGET_S,budget.CONTEXT_BUDGET_S,budget.OPTIONAL_BUDGET_S,budget.OPTIONS_BUDGET_S,budget.RESPONSE_RESERVE_S),(25,21,1,2,.1))
        self.started=time.monotonic()
    def tearDown(self):receipts.append({'test':self.id().split('.')[-1],'elapsed':round(time.monotonic()-self.started,3),'upstream_calls':dict(counts)})
    def test_default_context_over_eight_seconds(self):
        state['delays']['/api/features/v2']=8.2
        r=httpx.get(BASE+'/api/run?ticker=TEST',timeout=28)
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(counts['/api/features/v2'],1)
    def test_default_context_cap_no_replay(self):
        # Keep the long21s boundary verification candidate-only; original retry
        # amplification is already demonstrated above at the actual8s default.
        state['delays']['/api/features/v2']=26
        r=httpx.get(BASE+'/api/run?ticker=TEST',timeout=28)
        elapsed=time.monotonic()-self.started
        self.assertEqual(r.status_code,502);self.assertTrue(r.json()['detail'].startswith('GET '))
        self.assertGreater(elapsed,20.5);self.assertLess(elapsed,24)
        self.assertEqual(counts['/api/features/v2'],1);self.assertEqual(counts['/api/recommend'],0)

real_client=httpx.AsyncClient

cases=[]
for code in [408,500,502,503,504]:cases.append((str(code),code,3))
for code in [400,401,403,404,409,422,429]:cases.append((str(code),code,1))
for error in [httpx.ConnectError,httpx.ConnectTimeout,httpx.PoolTimeout]:cases.append((error.__name__,error,3))
for error in [httpx.ReadTimeout,httpx.WriteTimeout,httpx.ReadError,httpx.WriteError,httpx.RemoteProtocolError]:cases.append((error.__name__,error,1))
cases.extend([('malformed','malformed',1),('success','success',1),('cancel',asyncio.CancelledError,1)])
class RetryContracts(unittest.TestCase):
    def setUp(self):
        appmod.TIMEOUT=2;appmod.RETRIES=2;appmod.DELAY=.01

for method in ['GET','POST']:
    for label,outcome,attempts in cases:
        def test(self,method=method,label=label,outcome=outcome,attempts=attempts):
            calls=[];sleeps=[]
            async def handler(request):
                calls.append(request)
                if outcome=='success':return httpx.Response(200,json={'fixture':'unchanged'})
                if outcome=='malformed':return httpx.Response(200,content=b'bad')
                if isinstance(outcome,int):return httpx.Response(outcome,json={})
                if outcome is asyncio.CancelledError:raise asyncio.CancelledError()
                raise outcome('fixture failure',request=request)
            def factory(**kwargs):return real_client(transport=httpx.MockTransport(handler),**kwargs)
            async def sleep(delay):sleeps.append(delay)
            async def run():
                return await (appmod._get_json('http://fixture/test',{'x':'y'}) if method=='GET' else appmod._post_json('http://fixture/test',{'x':'y'}))
            with patch.object(httpx,'AsyncClient',factory),patch.object(budget,'asyncio',types.SimpleNamespace(**{**vars(asyncio),'sleep':sleep})):
                if outcome=='success':self.assertEqual(asyncio.run(run()),{'fixture':'unchanged'})
                elif outcome is asyncio.CancelledError:
                    with self.assertRaises(asyncio.CancelledError):asyncio.run(run())
                else:
                    with self.assertRaises(Exception) as c:asyncio.run(run())
                    self.assertEqual(c.exception.status_code,502)
                    self.assertTrue(c.exception.detail.startswith(method+' http://fixture/test failed:'))
            self.assertEqual(len(calls),attempts)
            self.assertEqual(len(sleeps),attempts-1)
            self.assertEqual(calls[0].method,method)
            if method=='POST':self.assertEqual(json.loads(calls[0].content),{'x':'y'})
            else:self.assertEqual(calls[0].url.params['x'],'y')
            receipts.append({'method':method,'outcome':label,'attempts':len(calls),'sleeps':len(sleeps)})
        setattr(RetryContracts,'test_'+method+'_'+label,test)

def main():
    global server, URL, sock, port, uv, thread, BASE
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler); server.daemon_threads=True
    threading.Thread(target=server.serve_forever,daemon=True).start()
    URL=f'http://127.0.0.1:{server.server_port}'
    appmod.CTX_URL=URL;appmod.REC_URL=URL
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    config=uvicorn.Config(appmod.app,log_level='error',lifespan='off')
    uv=uvicorn.Server(config);thread=threading.Thread(target=uv.run,kwargs={'sockets':[sock]},daemon=True);thread.start()
    deadline=time.monotonic()+10
    while not uv.started:
        if not thread.is_alive() or time.monotonic()>deadline: raise RuntimeError('Gateway fixture did not start')
        time.sleep(.01)
    BASE=f'http://127.0.0.1:{port}'
    try:
        suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls)
            for cls in (Contract, Defaults, RetryContracts))
        result=unittest.TextTestRunner(verbosity=2).run(suite)
        print(json.dumps({'tests':result.testsRun,'failures':len(result.failures),
            'errors':len(result.errors),'skipped':len(result.skipped),'receipts':receipts},indent=2))
        return 0 if result.wasSuccessful() and result.testsRun==64 and not result.skipped else 1
    finally:
        uv.should_exit=True
        thread.join(timeout=5)
        server.shutdown()
        server.server_close()
        sock.close()

if __name__=='__main__':
    sys.exit(main())
