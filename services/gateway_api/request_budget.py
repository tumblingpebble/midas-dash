"""Staged gateway-only budget boundary; upstream sync work is not cancellable."""
import asyncio
from contextvars import ContextVar
import threading
import time
import httpx
from fastapi import HTTPException

REQUEST_BUDGET_S = 25.0
CONTEXT_BUDGET_S = 21.0
OPTIONAL_BUDGET_S = 1.0
OPTIONS_BUDGET_S = 2.0
RESPONSE_RESERVE_S = 0.1
_deadline = ContextVar("gateway_deadline", default=None)
_option_slots = threading.BoundedSemaphore(2)

def remaining():
    deadline = _deadline.get()
    return max(0.0, deadline - time.monotonic()) if deadline is not None else REQUEST_BUDGET_S

async def request_json(method, url, *, params=None, payload=None,
                       timeout=8.0, retries=2, delay=0.25, budget=None):
    last_exc = TimeoutError("request budget exhausted")
    # One total operation budget, not a fresh budget per phase or retry.
    end = time.monotonic() + min(remaining(), budget if budget is not None else timeout)
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        for attempt in range(retries + 1):
            left = min(remaining(), end - time.monotonic())
            if left <= 0:
                break
            try:
                # wait_for bounds DNS, pool, connect, write, read, and slow-drip bodies.
                # A separate HTTPX read timeout would otherwise cut the context back to 8s.
                r = await asyncio.wait_for(client.request(method, url, params=params,
                    json=payload, timeout=left), timeout=left)
                r.raise_for_status()
                return r.json()
            except Exception as exc:
                last_exc = exc
                # Reads/writes/timeouts may already have started costly upstream work.
                # Only failures known to precede dispatch or explicit transient statuses replay.
                retryable = isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)) or (
                    isinstance(exc, httpx.HTTPStatusError)
                    and exc.response.status_code in {408, 500, 502, 503, 504})
                left = min(remaining(), end - time.monotonic())
                if not retryable or attempt >= retries or left <= delay:
                    break
                await asyncio.sleep(delay)
    raise HTTPException(status_code=502, detail=f"{method} {url} failed: {last_exc}")

def optional_budget(cap):
    return max(0.0, min(cap, remaining() - RESPONSE_RESERVE_S))

async def optional_options(func, **kwargs):
    allotted = optional_budget(OPTIONS_BUDGET_S)
    if allotted <= 0:
        raise RuntimeError("option chain request budget exhausted")
    # Acquire before submitting: at most two active/queued jobs, even after cancellation.
    if not _option_slots.acquire(blocking=False):
        raise RuntimeError("option chain capacity unavailable")
    def held_call():
        try:
            return func(**kwargs)
        finally:
            _option_slots.release()
    try:
        future = asyncio.get_running_loop().run_in_executor(None, held_call)
    except BaseException:
        _option_slots.release()
        raise
    # Consume late exceptions; never free occupancy until the actual sync call returns.
    future.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
    try:
        return await asyncio.wait_for(asyncio.shield(future), allotted)
    except asyncio.TimeoutError:
        raise RuntimeError("option chain request budget exhausted") from None

async def run_with_budget(request, operation):
    token = _deadline.set(time.monotonic() + REQUEST_BUDGET_S)
    task = asyncio.create_task(operation())
    async def watch_disconnect():
        while not await request.is_disconnected():
            await asyncio.sleep(0.05)
    watcher = asyncio.create_task(watch_disconnect())
    try:
        done, _ = await asyncio.wait({task, watcher}, timeout=REQUEST_BUDGET_S,
                                     return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            return await task
        if watcher in done:
            raise HTTPException(status_code=499, detail="Client disconnected")
        raise HTTPException(status_code=502, detail="MIDAS request budget exhausted")
    finally:
        task.cancel()
        watcher.cancel()
        await asyncio.gather(task, watcher, return_exceptions=True)
        _deadline.reset(token)
