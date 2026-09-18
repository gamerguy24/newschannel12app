// Scratch check of the router shim against Node's own Request/Response.
const m = await import('./router.js');

const r = m.Router();
r.get('/radar/nexrad/:site/:product', async (req, res) => res.json({ p: req.params, q: req.query }));
r.post('/closings', async (req, res) => res.status(201).json({ got: req.body }));
r.get('/boom', async () => {
  throw new Error('handler exploded');
});
r.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream' });
  res.flushHeaders();
  res.write('event: open\n');
  setTimeout(() => {
    res.write('data: tick\n\n');
    res.end();
  }, 30);
});

const mounts = [{ prefix: '/api', router: r }];
const call = async (method, path, body) => {
  const url = new URL('http://x' + path);
  const init = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return m.dispatch(mounts, new Request(url, init), url);
};

const a = await call('GET', '/api/radar/nexrad/KOHX/N0B.png?scale=2');
console.log('params+query:', a.status, await a.text());

const b = await call('POST', '/api/closings', { name: 'Wilson County Schools' });
console.log('body+status:', b.status, await b.text());

const c = await call('GET', '/api/stream');
console.log('sse:', c.status, c.headers.get('content-type'), JSON.stringify(await c.text()));

const d = await call('GET', '/api/nope');
console.log('unmatched:', d);

try {
  await call('GET', '/api/boom');
  console.log('PROBLEM: a thrown handler did not propagate');
} catch (err) {
  console.log('throw propagates:', err.message);
}
