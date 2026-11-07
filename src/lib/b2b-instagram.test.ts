import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySiteScan,
  dedupeProfiles,
  extractContacts,
  filterProfiles,
  igProfileUrl,
  normalizeHashtags,
  postAuthor,
  apifyDatasetSeeds, apifyHashtagInput,
  profileToCompany,
  type IgProfileSeed,
  type InstagramProfile,
} from "./b2b-instagram";
import { extractJsonLdAddresses } from "./b2b-public-enrichment";

test('input oficial preserva cinco hashtags separadas e limite de posts por URL', () => {
  for (const limit of [20, 50, 100] as const) assert.deepEqual(apifyHashtagInput('facilities', limit), {directUrls:['https://www.instagram.com/explore/tags/facilities/'],resultsType:'posts',resultsLimit:limit,addParentData:true});
});
test('dataset separa erro, vazio real e publicações sem autor', () => {
  assert.equal(apifyDatasetSeeds([], 'facilities').items,0);
  assert.equal(apifyDatasetSeeds([{error:'not_found'}], 'facilities').failures,1);
  assert.equal(apifyDatasetSeeds([{caption:'sem autor'}], 'facilities').unrecognized,1);
  assert.equal(apifyDatasetSeeds([{ownerUsername:'facilitiesbr', ownerId:'123'}], 'facilities').seeds[0].username,'facilitiesbr');
  assert.equal(apifyDatasetSeeds([{latestPosts:[{ownerUsername:'alfa'}]}], 'facilities').seeds.length,1);
  assert.throws(() => apifyDatasetSeeds({items:[]},'facilities'),/formato inválido/);
});

test("normalizeHashtags limpa, deduplica e limita a 5", () => {
  assert.deepEqual(normalizeHashtags("#facilities, terceirizacao  #FACILITIES;;limpeza"), ["facilities", "terceirizacao", "limpeza"]);
  assert.deepEqual(normalizeHashtags("a #ok ##duplo #ok"), ["ok", "duplo"]);
  assert.equal(normalizeHashtags("um dois tres quatro cinco seis sete").length, 5);
  assert.deepEqual(normalizeHashtags("!!! ### ,"), []);
});

test("igProfileUrl valida o formato do usuário", () => {
  assert.equal(igProfileUrl("Empresa.Teste"), "https://www.instagram.com/empresa.teste/");
  assert.equal(igProfileUrl("@fornecedor_01"), "https://www.instagram.com/fornecedor_01/");
  assert.equal(igProfileUrl("nome com espaco"), "");
  assert.equal(igProfileUrl(""), "");
});

test("postAuthor identifica o autor e ignora itens sem perfil válido", () => {
  const seed = postAuthor(
    {
      ownerUsername: "FacilitiesBR",
      ownerId: 12345,
      ownerFullName: "Facilities BR",
      caption: "Atendemos indústrias",
      url: "https://www.instagram.com/p/ABC123/",
    },
    "facilities",
  );
  assert.ok(seed);
  assert.equal(seed.username, "facilitiesbr");
  assert.equal(seed.igUserId, "12345");
  assert.equal(seed.hashtag, "facilities");
  assert.equal(postAuthor({ caption: "sem autor" }, "facilities"), null);
  assert.equal(postAuthor({ ownerUsername: "inválido espaço" }, "facilities"), null);
});

test("dedupeProfiles remove duplicados por ID e por username", () => {
  const base: IgProfileSeed = { username: "alfa", igUserId: "1", fullName: "", captionSample: "", locationName: "", hashtag: "x", postUrl: "" };
  const out = dedupeProfiles([
    base,
    { ...base, postUrl: "https://www.instagram.com/p/outro/" },
    { ...base, username: "alfa2" }, // mesmo ID, outro username
    { ...base, username: "beta", igUserId: "2" },
  ]);
  assert.deepEqual(out.map((p) => p.username), ["alfa", "beta"]);
});

test("extractContacts encontra e-mail, WhatsApp e site públicos sem inventar", () => {
  const c = extractContacts("Contato: comercial@empresa.com.br 📱 WhatsApp: (41) 99999-1234", "https://empresa.com.br");
  assert.equal(c.email, "comercial@empresa.com.br");
  assert.equal(c.phone, "5541999991234");
  assert.equal(c.whatsapp, "5541999991234");
  assert.equal(c.website, "https://empresa.com.br/");
  const fixo = extractContacts("Tel: (41) 3333-1234", "");
  assert.equal(fixo.phone, "554133331234");
  assert.equal(fixo.whatsapp, "");
  const vazio = extractContacts("Só texto, sem contato", "javascript:alert(1)");
  assert.deepEqual(vazio, { email: "", phone: "", whatsapp: "", website: "" });
});

test("applySiteScan preenche somente campos vazios e valida o CNPJ", () => {
  const scan = { emails: ["site@empresa.com.br"], phones: ["554133331234"], whatsapp: ["5541999991234"], cnpjs: ["11222333000181"], addresses: ["Rua A, 10, Curitiba, PR"] };
  const vazio = { email: "", phone: "", whatsapp: "", cnpj: "", address: "" };
  assert.deepEqual(applySiteScan(vazio, scan), {
    email: "site@empresa.com.br",
    phone: "554133331234",
    whatsapp: "5541999991234",
    cnpj: "11222333000181",
    address: "Rua A, 10, Curitiba, PR",
  });
  // Dados declarados no próprio Instagram nunca são substituídos pelos do site.
  const preenchido = { email: "bio@empresa.com.br", phone: "41999990000", whatsapp: "41999990000", cnpj: "", address: "" };
  const patch = applySiteScan(preenchido, scan);
  assert.equal(patch.email, undefined);
  assert.equal(patch.phone, undefined);
  assert.equal(patch.whatsapp, undefined);
  assert.equal(patch.cnpj, "11222333000181");
  // CNPJ inválido do site é descartado.
  assert.equal(applySiteScan(vazio, { ...scan, cnpjs: ["11111111111111"] }).cnpj, undefined);
});

test("extractJsonLdAddresses lê endereço estruturado e ignora JSON inválido", () => {
  const html = `<script type="application/ld+json">{"@type":"LocalBusiness","address":{"@type":"PostalAddress","streetAddress":"Rua das Flores, 123","addressLocality":"Curitiba","addressRegion":"PR"}}</script>`;
  assert.deepEqual(extractJsonLdAddresses(html), ["Rua das Flores, 123, Curitiba, PR"]);
  assert.deepEqual(extractJsonLdAddresses(`<script type="application/ld+json">{invalido</script>`), []);
  assert.deepEqual(extractJsonLdAddresses("<p>sem dados estruturados</p>"), []);
});

test("profileToCompany cria cadastro de revisão com origem Instagram - Apify", () => {
  const profile: InstagramProfile = {
    id: "1", username: "facilitiesbr", igUserId: "1", fullName: "Facilities BR", biography: "",
    category: "Serviços", externalUrl: "https://empresa.com.br", email: "a@b.com", phone: "41999991234",
    whatsapp: "41999991234", address: "", country: "", cnpj: "", enrichment: "concluido",
    city: "Curitiba", state: "PR", hashtag: "facilities", postUrl: "", followers: 1200, isBusiness: true,
    aiSegment: "Facilities", aiLocation: "Curitiba/PR", aiRelevance: "alta", aiCommercial: true,
    aiSummary: "Empresa de facilities.", analyzedAt: null, inCrm: false,
  };
  const company = profileToCompany(profile);
  assert.equal(company.source, "instagram");
  assert.equal(company.cnpj, "");
  assert.equal(company.placeId, "");
  assert.equal(company.instagram, "https://www.instagram.com/facilitiesbr/");
  assert.equal(company.tradeName, "Facilities BR");
  assert.equal(company.sourceReference, "Instagram - Apify · @facilitiesbr · #facilities");
  assert.deepEqual(company.emails, ["a@b.com"]);
  assert.deepEqual(company.whatsappNumbers, ["41999991234"]);
  // CNPJ válido encontrado no site entra no cadastro; inválido é descartado.
  assert.equal(profileToCompany({ ...profile, cnpj: "11222333000181" }).cnpj, "11222333000181");
  assert.equal(profileToCompany({ ...profile, cnpj: "11111111111111" }).cnpj, "");
});

test("filterProfiles aplica filtros de contato, segmento e CRM", () => {
  const base: InstagramProfile = {
    id: "1", username: "a", igUserId: "", fullName: "Alfa", biography: "", category: "",
    externalUrl: "", email: "", phone: "", whatsapp: "", address: "", country: "", cnpj: "",
    enrichment: "pendente", city: "", state: "", hashtag: "x", postUrl: "",
    followers: null, isBusiness: null, aiSegment: "", aiLocation: "", aiRelevance: "", aiCommercial: null,
    aiSummary: "", analyzedAt: null, inCrm: false,
  };
  const list = [
    base,
    { ...base, id: "2", username: "b", fullName: "Beta", email: "b@b.com", aiSegment: "Facilities" },
    { ...base, id: "3", username: "c", fullName: "Gama", phone: "41999990000", whatsapp: "5541999990000", inCrm: true },
  ];
  const empty = { text: "", segment: "", hasEmail: false, hasWhatsapp: false, hasSite: false, notInCrm: false };
  assert.equal(filterProfiles(list, empty).length, 3);
  assert.deepEqual(filterProfiles(list, { ...empty, hasEmail: true }).map((p) => p.username), ["b"]);
  assert.deepEqual(filterProfiles(list, { ...empty, hasWhatsapp: true }).map((p) => p.username), ["c"]);
  assert.deepEqual(filterProfiles(list, { ...empty, notInCrm: true }).map((p) => p.username), ["a", "b"]);
  assert.deepEqual(filterProfiles(list, { ...empty, segment: "facil" }).map((p) => p.username), ["b"]);
  assert.deepEqual(filterProfiles(list, { ...empty, text: "alfa" }).map((p) => p.username), ["a"]);
});
