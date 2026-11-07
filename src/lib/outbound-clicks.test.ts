import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickClassification, rewriteEmailLinks, trackingDestination, lastEmailClick } from './outbound-clicks';
test('abertura e verificador nunca contam como clique humano', () => {
  assert.equal(clickClassification(new Headers({'user-agent':'Proofpoint scanner'})), 'automated');
  assert.equal(clickClassification(new Headers({'user-agent':'Mozilla/5.0'})), 'unknown');
  assert.equal(clickClassification(new Headers({'sec-fetch-user':'?1','sec-fetch-mode':'navigate'})), 'human');
  assert.equal(clickClassification(new Headers({'sec-fetch-user':'?1','sec-fetch-mode':'navigate','purpose':'prefetch'})), 'automated');
});
test('links HTML e texto usam o mesmo token sem rastrear imagens ou mailto', async () => {
  let n = 0;
  const c = await rewriteEmailLinks({html:'<a href="https://example.com/?a=1&amp;b=2">Oi</a><img src="https://example.com/image.jpg"><a href="mailto:a@b.com">Email</a>',text:'https://example.com/?a=1&b=2'}, async () => { n++;return 'https://crm.example.com/c/token'; });
  assert.equal(n, 1); assert.ok(c.html.includes('href="https://crm.example.com/c/token"')); assert.equal(c.text,'https://crm.example.com/c/token'); assert.ok(c.html.includes('src="https://example.com/image.jpg"')); assert.ok(c.html.includes('mailto:a@b.com'));
});
test('destino não aceita credenciais, scripts nem endereço local', () => {
  for (const u of ['javascript:alert(1)','https://user:pass@example.com','https://127.0.0.1/x']) assert.equal(trackingDestination(u),null);
  assert.equal(trackingDestination('https://example.com/x'),'https://example.com/x');
});
test('ordenação usa o clique mais recente, não abertura nem interação manual', () => {
  assert.equal(lastEmailClick({history:[{id:'outbound-click:1',date:'2026-11-07T01:00:00Z',text:''},{id:'outbound-click:2',date:'2026-11-07T02:00:00Z',text:''},{id:'open',date:'2026-11-08T02:00:00Z',text:''}]}),Date.parse('2026-11-07T02:00:00Z'));
});