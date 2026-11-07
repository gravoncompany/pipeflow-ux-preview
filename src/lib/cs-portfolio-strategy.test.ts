import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientStrategy, portfolioStrategy, strategicSchema } from './cs-portfolio-strategy';
const c = (o: Partial<Parameters<typeof clientStrategy>[0]> = {}, s: Partial<ReturnType<typeof strategicSchema.parse>> | null = null) => ({ id: 'x', name: 'X', mrrCents: 100000, overdueCents: 0, confirmedCents: 0, health: null, commercialStatus: null, strategic: s ? strategicSchema.parse(s) : null, ...o });
test('sem custo individualizado a rentabilidade não é calculada', () => { assert.equal(clientStrategy(c(), 100000).profitability, null); });
test('ticket baixo sozinho não vira baixa rentabilidade nem renegociação', () => {
  const r = clientStrategy(c({ mrrCents: 50000 }, { relationship: 'boa' }), 150000);
  assert.equal(r.profitability, null); assert.equal(r.recommendation, 'manter');
});
test('demanda alta com ticket abaixo do médio sugere renegociar', () => { assert.equal(clientStrategy(c({ mrrCents: 50000 }, { demand: 'alto', relationship: 'regular' }), 150000).recommendation, 'renegociar'); });
test('baixa rentabilidade + relacionamento difícil sugere avaliar encerramento', () => { assert.equal(clientStrategy(c({}, { relationship: 'dificil', directCostCents: 90000 }), 100000).recommendation, 'avaliar_encerramento'); });
test('potencial de expansão alto e sem atraso sugere expandir', () => { assert.equal(clientStrategy(c({}, { relationship: 'boa', expansion: 'alto' }), 100000).recommendation, 'expandir'); });
test('margem (1500 − 500) ÷ 1500 ≈ 67% é alta', () => { const r = clientStrategy(c({ mrrCents: 150000 }, { relationship: 'boa', directCostCents: 50000 }), 100000); assert.equal(r.profitability, 'alta'); assert.equal(r.recommendation, 'manter'); });
test('sem dados não há recomendação', () => { assert.equal(clientStrategy(c(), null).recommendation, null); });
test('resumo soma receita por grupo', () => { const p = portfolioStrategy([c({ id: 'a' }, { expansion: 'alto' }), c({ id: 'b', mrrCents: 300000 }, { expansion: 'medio' })]); assert.equal(p.summary.expansion.count, 2); assert.equal(p.summary.expansion.mrrCents, 400000); });
