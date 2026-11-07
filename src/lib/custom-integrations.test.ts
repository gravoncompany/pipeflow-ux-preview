import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integrationTestPath } from './custom-integrations';
test('Apify testa o Actor por GET sem usar runId ou iniciar execução paga', () => {
  assert.equal(integrationTestPath('https://api.apify.com/v2','Apify - Instagram Scraper',[{method:'POST',path:'/acts/apify~instagram-scraper/runs'},{method:'GET',path:'/actor-runs/{runId}'}]),'/acts/apify~instagram-scraper');
});
test('demais integrações mantêm GET fixo e rejeitam placeholders', () => {
  assert.equal(integrationTestPath('https://example.com','Outra',[{method:'GET',path:'/health'}]),'/health');
  assert.throws(() => integrationTestPath('https://example.com','Outra',[{method:'GET',path:'/{id}'}]),/identificador pendente/);
});