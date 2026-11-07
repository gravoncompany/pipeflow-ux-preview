import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  closingDate,
  countNewCustomers,
  decideFirstAcquisition,
  inPeriod,
} from "./sale-classifications";

describe("closingDate", () => {
  it("prefere a data registrada da transição para fechado", () => {
    assert.deepEqual(closingDate({ closed_at: "2026-10-20", entry_date: "2026-09-01" }), {
      date: "2026-10-20",
      basis: "closed_at",
    });
  });

  it("usa a data de entrada para fechamentos antigos sem data registrada", () => {
    assert.deepEqual(closingDate({ closed_at: null, entry_date: "2026-09-01" }), {
      date: "2026-09-01",
      basis: "entry_date",
    });
  });
});

describe("inPeriod", () => {
  it("inclui as datas extremas e exclui fora do intervalo", () => {
    assert.equal(inPeriod("2026-10-01", "2026-10-01", "2026-10-31"), true);
    assert.equal(inPeriod("2026-10-31", "2026-10-01", "2026-10-31"), true);
    assert.equal(inPeriod("2026-09-30", "2026-10-01", "2026-10-31"), false);
    assert.equal(inPeriod("2026-11-01", "2026-10-01", "2026-10-31"), false);
  });
});

describe("countNewCustomers", () => {
  const row = (
    customerKey: string,
    saleType: "novo" | "renovacao" | "adicional",
    firstAcquisition: boolean,
    closedOn: string,
  ) => ({ customerKey, saleType, firstAcquisition, closedOn });

  it("conta clientes distintos pela primeira aquisição confirmada no período", () => {
    const rows = [
      row("1199999123", "novo", true, "2026-10-05"),
      row("2188888567", "novo", true, "2026-10-12"),
    ];
    assert.equal(countNewCustomers(rows, "2026-10-01", "2026-10-31"), 2);
  });

  it("conta o mesmo cliente uma única vez mesmo com várias oportunidades", () => {
    const rows = [
      row("1199999123", "novo", true, "2026-10-05"),
      row("1199999123", "novo", false, "2026-10-20"),
    ];
    assert.equal(countNewCustomers(rows, "2026-10-01", "2026-10-31"), 1);
  });

  it("exclui renovações e vendas adicionais do denominador", () => {
    const rows = [
      row("1199999123", "renovacao", false, "2026-10-05"),
      row("2188888567", "adicional", false, "2026-10-12"),
    ];
    assert.equal(countNewCustomers(rows, "2026-10-01", "2026-10-31"), 0);
  });

  it("usa a data da aquisição, não a da classificação, e respeita o período", () => {
    const rows = [row("1199999123", "novo", true, "2026-09-15")];
    assert.equal(countNewCustomers(rows, "2026-10-01", "2026-10-31"), 0);
    assert.equal(countNewCustomers(rows, "2026-09-01", "2026-09-30"), 1);
  });

  it("ignora aquisição marcada como não primeira", () => {
    const rows = [row("1199999123", "novo", false, "2026-10-05")];
    assert.equal(countNewCustomers(rows, "2026-10-01", "2026-10-31"), 0);
  });
});

describe("decideFirstAcquisition", () => {
  it("primeira aquisição confirmada quando não há anterior", () => {
    assert.deepEqual(decideFirstAcquisition("novo", 0, false), {
      conflict: false,
      firstAcquisition: true,
    });
  });

  it("avisa e pede revisão quando já existe aquisição anterior", () => {
    assert.deepEqual(decideFirstAcquisition("novo", 1, false), { conflict: true });
  });

  it("mantido como novo após aviso nunca conta como primeira aquisição", () => {
    assert.deepEqual(decideFirstAcquisition("novo", 1, true), {
      conflict: false,
      firstAcquisition: false,
    });
  });

  it("renovação e venda adicional nunca são primeira aquisição", () => {
    assert.deepEqual(decideFirstAcquisition("renovacao", 0, false), {
      conflict: false,
      firstAcquisition: false,
    });
    assert.deepEqual(decideFirstAcquisition("adicional", 2, false), {
      conflict: false,
      firstAcquisition: false,
    });
  });
});
