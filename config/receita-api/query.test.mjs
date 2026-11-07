import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery } from './query.mjs';
test('all user values stay bound; no SQL injection or wildcard expansion', () => {
  const value = "%' OR 1=1 --";
  const q = buildQuery({ legalName: value, cnae:'7319002', municipality:'8105', hasEmail:true });
  assert.equal(q.where.includes(value), false);
  assert.deepEqual(q.params, ['SC', '8105', "%\\%' OR 1=1 --%", '7319002']);
  assert.match(q.where, /municipio_codigo = \$2/);
});
test('page bound is 100 rows, and code searches do not require a catalogue', () => {
  const q = buildQuery({ cnae:'7319-0/02', page:2, pageSize:100 });
  assert.deepEqual(q.params, ['SC','7319002']); assert.equal(q.offset,100);
  assert.throws(() => buildQuery({ pageSize:101 }));
  assert.throws(() => buildQuery({ page:1001 }));
});
test('descriptions use only verified CNAE catalogue, never a fictitious description column', () => {
  assert.throws(() => buildQuery({ segment:'Publicidade' }), /cnae_catalog_pending/);
  const q = buildQuery({ segment:'Publicidade' }, [{ codigo:'7319002',descricao:'Promoção de publicidade' }]);
  assert.deepEqual(q.params, ['SC',['7319002']]);
  assert.equal(q.where.includes('cnae_descricao'),false);
});