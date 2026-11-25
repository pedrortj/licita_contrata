import { apiFetch } from './api.js';
import { clearToken, redirectToLogin, requireAuthentication } from './auth.js';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1';
const PNCP_REPORT_DETAILS_STORAGE_KEY = 'pncp_report_details';
const LEGACY_PENDING_PNCP_STORAGE_KEY = 'pending_pncp_procurements';
const LEGACY_HIDDEN_LICITACOES_STORAGE_KEY = 'hidden_licitacoes';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('logout-button')?.addEventListener('click', () => {
    clearToken();
    redirectToLogin();
  });

  const cardsContainer = document.getElementById('cards-container');
  const statusElement = document.getElementById('api-status');
  const searchInput = document.getElementById('licitacao-search');
  const searchButton = document.getElementById('licitacao-search-button');
  const reloadButton = document.getElementById('licitacao-reload-button');
  localStorage.removeItem(LEGACY_HIDDEN_LICITACOES_STORAGE_KEY);

  function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle('error', isError);
  }

  function normalizeListResponse(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const possibleKeys = ['items', 'results', 'data', 'licitacoes', 'content', 'rows'];
    for (const key of possibleKeys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }

    if (payload.licitacao || payload.licitacoes || payload.data) {
      const nested = payload.licitacao || payload.licitacoes || payload.data;
      return Array.isArray(nested) ? nested : [nested];
    }

    return [payload];
  }

  function normalizeSingleResponse(payload) {
    if (!payload) {
      return null;
    }

    if (Array.isArray(payload)) {
      return payload[0] || null;
    }

    if (typeof payload !== 'object') {
      return null;
    }

    if (payload.resumo_edital || payload.resumoEdital || payload.arquivo || payload.numero_controle_pncp) {
      return payload;
    }

    const candidates = [payload.licitacao, payload.data, payload.result, payload.item, payload.record];
    for (const candidate of candidates) {
      if (candidate) {
        return candidate;
      }
    }

    return payload;
  }

  function getValue(record, keys) {
    for (const key of keys) {
      if (record && record[key] !== undefined && record[key] !== null && record[key] !== '') {
        return record[key];
      }
    }
    return null;
  }

  function getLicitationRecord(item) {
    return item?.licitacao || item || {};
  }

  function getStoredPncpProcurements() {
    const stored = localStorage.getItem(PNCP_REPORT_DETAILS_STORAGE_KEY)
      || localStorage.getItem(LEGACY_PENDING_PNCP_STORAGE_KEY);
    if (!stored) {
      return [];
    }

    try {
      const procurements = JSON.parse(stored);
      if (!Array.isArray(procurements)) {
        localStorage.removeItem(PNCP_REPORT_DETAILS_STORAGE_KEY);
        localStorage.removeItem(LEGACY_PENDING_PNCP_STORAGE_KEY);
        setStatus('Os dados locais das licitações estavam inválidos e foram removidos.', true);
        return [];
      }

      const processedProcurements = procurements.filter((item) => item && item._requiresReport !== true
        && item.numero_controle_pncp && (item.dados_pncp || item.pncp));
      if (processedProcurements.length !== procurements.length
        || localStorage.getItem(LEGACY_PENDING_PNCP_STORAGE_KEY)) {
        if (processedProcurements.length) {
          localStorage.setItem(PNCP_REPORT_DETAILS_STORAGE_KEY, JSON.stringify(processedProcurements));
        } else {
          localStorage.removeItem(PNCP_REPORT_DETAILS_STORAGE_KEY);
        }
        localStorage.removeItem(LEGACY_PENDING_PNCP_STORAGE_KEY);
      }
      return processedProcurements;
    } catch {
      localStorage.removeItem(PNCP_REPORT_DETAILS_STORAGE_KEY);
      localStorage.removeItem(LEGACY_PENDING_PNCP_STORAGE_KEY);
      setStatus('Os dados locais da busca estavam inválidos e foram removidos.', true);
      return [];
    }
  }

  function saveStoredPncpProcurement(record) {
    const procurements = getStoredPncpProcurements();
    const recordId = record.numero_controle_pncp;
    const nextProcurements = [
      ...procurements.filter((item) => item.numero_controle_pncp !== recordId),
      record
    ];
    localStorage.setItem(PNCP_REPORT_DETAILS_STORAGE_KEY, JSON.stringify(nextProcurements));
  }

  function getProcurementId(record) {
    const licitacao = getLicitationRecord(record);
    return getValue(record, ['numero_controle_pncp', 'numeroControlePncp'])
      || getValue(licitacao, ['numero_controle_pncp', 'numeroControlePncp']);
  }

  function getLicitacaoIdentity(record) {
    const licitacao = getLicitationRecord(record);
    return getProcurementId(record)
      || getValue(record, ['numero', 'id'])
      || getValue(licitacao, ['numero', 'id']);
  }

  function mergeSavedAndPncpLicitacoes(savedLicitacoes, storedProcurements) {
    const storedById = new Map(
      storedProcurements.map((record) => [record.numero_controle_pncp, record])
    );
    return savedLicitacoes.map((record) => {
      const id = getProcurementId(record);
      if (!id) {
        return record;
      }

      const stored = storedById.get(id);
      if (!stored) {
        return record;
      }

      return {
        ...stored,
        ...record,
        numero_controle_pncp: id,
        dados_pncp: stored.dados_pncp || stored.pncp,
        pncp: stored.dados_pncp || stored.pncp,
        licitacao: {
          ...getLicitationRecord(stored),
          ...getLicitationRecord(record),
          numero_controle_pncp: id,
          objeto: getValue(getLicitationRecord(record), ['objeto', 'objeto_compra', 'descricao'])
            || getValue(getLicitationRecord(stored), ['objeto', 'objetoCompra', 'objeto_compra', 'descricao'])
        },
        resumo_edital: getValue(record, ['resumo_edital', 'resumoEdital'])
          || getValue(stored, ['resumo_edital', 'resumoEdital'])
      };
    });
  }

  function parsePncpId(rawId) {
    const id = String(rawId || '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/\s+/g, '');
    const match = id.match(/^(\d{14})-(\d+)-(\d+)\/(\d{4})$/);

    if (!match) {
      throw new Error('Informe o ID completo no formato CNPJ-modalidade-sequencial/ano, por exemplo: 45787660000100-1-000350/2026.');
    }

    return {
      id,
      cnpj: match[1],
      modalidade: match[2],
      sequencial: match[3],
      ano: match[4]
    };
  }

  function unwrapPncpResponse(payload) {
    let result = payload;

    for (let depth = 0; depth < 3; depth += 1) {
      if (Array.isArray(result)) {
        result = result[0];
      } else if (result && typeof result === 'object') {
        const nested = result.data || result.resultado || result.contratacao || result.compra;
        if (nested && typeof nested === 'object') {
          result = nested;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  }

  async function fetchPncpProcurement(rawId) {
    const parsedId = parsePncpId(rawId);
    const path = `/orgaos/${parsedId.cnpj}/compras/${parsedId.ano}/${parsedId.sequencial}`;
    const response = await fetch(`${PNCP_API_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    const responseText = await response.text();
    let payload;

    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const details = payload?.message || payload?.mensagem || payload?.detail;
      throw new Error(
        details || (response.status === 404
          ? `Contratação ${parsedId.id} não encontrada no PNCP.`
          : `Não foi possível consultar o PNCP (erro ${response.status}).`)
      );
    }

    const procurement = unwrapPncpResponse(payload);
    if (!procurement) {
      throw new Error('O PNCP não retornou os dados da contratação pesquisada.');
    }

    return { ...parsedId, procurement };
  }

  function getSummaryText(item) {
    const summary = item?.resumo_edital || item?.resumoEdital || getLicitationRecord(item)?.resumo_edital;
    if (Array.isArray(summary)) {
      return summary.filter(Boolean).join('\n\n');
    }

    if (typeof summary === 'string' && summary.trim()) {
      return summary;
    }

    const record = getLicitationRecord(item);
    return getValue(record, ['resumo', 'description', 'descricao', 'objeto_compra', 'texto']) || 'Resumo não disponível.';
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getNestedValue(record, paths) {
    for (const path of paths) {
      let value = record;
      for (const key of path) {
        value = value?.[key];
      }
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
    return null;
  }

  function formatPncpDate(value, includeTime = true) {
    if (!value) {
      return null;
    }

    let dateValue = value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      dateValue = `${value}T12:00:00-03:00`;
    } else if (typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T/.test(value)
      && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      dateValue = `${value}-03:00`;
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    const options = includeTime
      ? { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }
      : { dateStyle: 'short', timeZone: 'America/Sao_Paulo' };
    return new Intl.DateTimeFormat('pt-BR', options).format(date);
  }

  function formatPncpCnpj(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 14
      ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
      : value;
  }

  function formatPncpCurrency(value) {
    if (typeof value !== 'number' && typeof value !== 'string') {
      return value;
    }

    const amount = Number(value);
    return Number.isFinite(amount)
      ? amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : value;
  }

  function getPncpDetails(record) {
    const procurement = record?.dados_pncp || record?.pncp;
    if (!procurement) {
      return [];
    }

    const fields = [
      ['Órgão/Entidade', [['orgaoEntidade', 'razaoSocial'], ['orgaoEntidade', 'nomeRazaoSocial']]],
      ['Unidade compradora', [['unidadeOrgao', 'nomeUnidade'], ['unidadeOrgao', 'nomeUnidadeOrgao']]],
      ['Localidade da Unidade', [['unidadeOrgao', 'municipioNome']]],
      ['Órgão/Entidade sub-rogado', [['orgaoSubRogado', 'razaoSocial']]],
      ['Unidade compradora sub-rogada', [['unidadeSubRogada', 'nomeUnidade']]],
      ['Localidade da Unidade sub-rogada', [['unidadeSubRogada', 'municipioNome']]],
      ['Modalidade da contratação', [['modalidadeNome'], ['nomeModalidade']]],
      ['Amparo legal', [['amparoLegal', 'nome'], ['amparoLegal', 'descricao'], ['amparoLegalNome']]],
      ['Tipo', [['tipoInstrumentoConvocatorioNome']]],
      ['Modo de disputa', [['modoDisputaNome'], ['modoDisputa']]],
      ['Registro de preço', [['srp']]],
      ['Fonte orçamentária', [['fontesOrcamentarias'], ['fonteOrcamentaria', 'descricao'], ['fonteOrcamentaria'], ['fonteOrcamentariaDescricao']]],
      ['Data de divulgação no PNCP', [['dataPublicacaoPncp'], ['dataPublicacao']]],
      ['Situação', [['situacaoCompraNome'], ['situacaoCompra'], ['status']]],
      ['Data de início de recebimento de propostas', [['dataAberturaProposta']]],
      ['Data fim de recebimento de propostas', [['dataEncerramentoProposta']]],
      ['Id contratação PNCP', [['numeroControlePNCP']]],
      ['Fonte', [['usuarioNome'], ['nomeSistemaOrigem'], ['sistemaOrigemNome']]],
      ['Última atualização', [['dataAtualizacao'], ['dataAtualizacaoPncp']]],
      ['Número do edital', [['numeroCompra'], ['numeroEdital'], ['numeroAviso']]],
      ['Valor total estimado/avaliado', [['valorTotalEstimado'], ['valorTotalHomologado']]]
    ];

    return fields.map(([label, paths]) => {
      let value = getNestedValue(procurement, paths);
      value = value === null ? 'Não informado' : value;

      if (Array.isArray(value)) {
        value = value.length
          ? value.map((item) => item?.nome || item?.descricao || String(item)).join(', ')
          : 'Não informado';
      }

      if (label === 'Última atualização' || label === 'Data de divulgação no PNCP'
        || label === 'Data de início de recebimento de propostas' || label === 'Data fim de recebimento de propostas') {
        value = value === 'Não informado'
          ? value
          : formatPncpDate(value, label !== 'Data de divulgação no PNCP');
      }
      if (label === 'Valor total estimado/avaliado') {
        value = value === 'Não informado' ? value : formatPncpCurrency(value);
      }
      if (label === 'Registro de preço' && typeof value === 'boolean') {
        value = value ? 'Sim' : 'Não';
      }
      if (label === 'Número do edital' && value !== 'Não informado') {
        const ano = getNestedValue(procurement, [['anoCompra']]);
        value = ano ? `${value}/${ano}` : value;
      }
      if (label === 'Órgão/Entidade' && value !== 'Não informado') {
        const cnpj = getNestedValue(procurement, [['orgaoEntidade', 'cnpj']]);
        value = cnpj ? `${formatPncpCnpj(cnpj)} - ${value}` : value;
      }
      if (label === 'Unidade compradora' && value !== 'Não informado') {
        const codigo = getNestedValue(procurement, [['unidadeOrgao', 'codigoUnidade']]);
        value = codigo ? `${codigo} - ${value}` : value;
      }
      if (label === 'Localidade da Unidade') {
        const uf = getNestedValue(procurement, [['unidadeOrgao', 'ufSigla']]);
        value = value === 'Não informado' ? value : (uf ? `${value}/${uf}` : value);
      }
      if (label === 'Localidade da Unidade sub-rogada' && value !== 'Não informado') {
        const uf = getNestedValue(procurement, [['unidadeSubRogada', 'ufSigla']]);
        value = uf ? `${value}/${uf}` : value;
      }

      return { label, value: String(value) };
    });
  }

  function renderPncpDetails(record) {
    const fields = getPncpDetails(record);
    if (fields.length === 0) {
      return '';
    }

    return `
      <span class="pncp-details" aria-label="Dados da contratação no PNCP">
        ${fields.map(({ label, value }) => `
          <span class="pncp-detail">
            <strong>${escapeHtml(label)}:</strong>
            <span>${escapeHtml(value)}</span>
          </span>
        `).join('')}
      </span>
    `;
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown).split(/\r?\n/);
    const html = [];
    let listOpen = false;

    const closeList = () => {
      if (listOpen) {
        html.push('</ul>');
        listOpen = false;
      }
    };

    lines.forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        closeList();
        return;
      }

      const escapedLine = escapeHtml(trimmedLine)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
      const heading = escapedLine.match(/^(#{1,6})\s+(.+)$/);
      const listItem = escapedLine.match(/^[-*]\s+(.+)$/);

      if (heading) {
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${heading[2]}</h${level}>`);
      } else if (listItem) {
        if (!listOpen) {
          html.push('<ul>');
          listOpen = true;
        }
        html.push(`<li>${listItem[1]}</li>`);
      } else {
        closeList();
        html.push(`<p>${escapedLine}</p>`);
      }
    });

    closeList();
    return html.join('');
  }

 

  function createDocumentHtml(record) {
    const licitacao = getLicitationRecord(record);
    const id = getValue(licitacao, ['numero_controle_pncp', 'numeroControlePncp', 'numero', 'id']) || 'licitacao';
    const objectValue = getValue(licitacao, ['objeto', 'objeto_compra', 'descricao', 'description', 'titulo']) || 'Objeto não informado';
    const summaryHtml = markdownToHtml(getSummaryText(record));
    const documentHtml = `
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8">
          <title>${escapeHtml(id)}</title>
          <style>
            @page { size: A4; margin: 3cm 2cm 2cm 3cm; }
            body {
              color: #000;
              font-family: "Times New Roman", Times, serif;
              font-size: 12pt;
              line-height: 1.5;
              margin: 0;
              text-align: justify;
              overflow-wrap: normal;
              word-break: normal;
            }
            h1, h2, h3, h4, h5, h6 {
              font-weight: 700;
              line-height: 1.5;
              margin: 18pt 0 6pt;
              page-break-after: avoid;
            }
            h1 { font-size: 14pt; text-align: center; }
            h2 { font-size: 13pt; }
            h3, h4, h5, h6 { font-size: 12pt; }
            p { margin: 0 0 12pt; text-indent: 1.25cm; }
            h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p { text-indent: 0; }
            ul { margin: 0 0 12pt 1.25cm; padding-left: 0.6cm; }
            li { margin-bottom: 6pt; padding-left: 0.15cm; }
            strong { font-weight: 700; }
            code { font-family: "Courier New", monospace; font-size: 10pt; }
            .document-title { text-align: center; font-weight: 700; text-transform: uppercase; margin-bottom: 24pt; }
            .object { text-indent: 0; }
            .object-label { font-weight: 700; }
          </style>
        </head>
        <body>
          <p class="document-title">Resumo da contratação</p>
          <p class="object"><span class="object-label">ID da contratação:</span> ${escapeHtml(id)}</p>
          <p class="object"><span class="object-label">Objeto:</span> ${escapeHtml(objectValue)}</p>
          ${summaryHtml}
        </body>
      </html>
    `;

    return documentHtml;
  }

  function createDocUrl(record) {
    return URL.createObjectURL(new Blob([createDocumentHtml(record)], { type: 'application/msword' }));
  }

  async function downloadPdfFromDocument(record, filename) {
    if (typeof window.html2pdf !== 'function') {
      throw new Error('O conversor de PDF não foi carregado. Verifique a conexão e tente novamente.');
    }

    const parsedDocument = new DOMParser().parseFromString(createDocumentHtml(record), 'text/html');
    const exportContainer = document.createElement('div');
    const documentStyles = document.createElement('style');
    documentStyles.textContent = parsedDocument.head.querySelector('style')?.textContent || '';
    exportContainer.appendChild(documentStyles);
    Array.from(parsedDocument.body.childNodes).forEach((node) => {
      exportContainer.appendChild(node.cloneNode(true));
    });
    exportContainer.style.width = '16cm';
    exportContainer.style.padding = '0';
    exportContainer.style.background = '#fff';
    exportContainer.style.color = '#000';
    exportContainer.style.fontFamily = '"Times New Roman", Times, serif';
    exportContainer.style.fontSize = '12pt';
    exportContainer.style.lineHeight = '1.5';
    exportContainer.style.textAlign = 'justify';
    document.body.appendChild(exportContainer);

    try {
      await window.html2pdf()
        .set({
          margin: [3, 2, 2, 3],
          filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'cm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] }
        })
        .from(exportContainer)
        .save();
    } finally {
      exportContainer.remove();
    }
  }

  function triggerDownload(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const CREATED_AT_KEYS = [
    'created_at', 'createdAt', 'criado_em', 'criadoEm', 'data_criacao', 'dataCriacao',
    'data_criação', 'data_resumo', 'data_analise', 'data_análise', 'analisado_em',
    'processado_em', 'updated_at', 'updatedAt', 'atualizado_em', 'timestamp', 'data'
  ];

  function formatCreatedAt(record) {
    const raw = getValue(record, CREATED_AT_KEYS) || getValue(getLicitationRecord(record), CREATED_AT_KEYS);
    if (!raw) {
      return '';
    }

    let value = raw;
    // Datas ISO sem fuso (ex.: 2026-05-10T14:30:00) vindas de servidores em UTC.
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(value)) {
      value += 'Z';
    }
    if (typeof value === 'number' && value < 1e12) {
      value *= 1000;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function buildCardTemplate(licitacao, isOpen = false) {
    const record = normalizeSingleResponse(licitacao);
    const licitacaoData = getLicitationRecord(record);
    const idValue = getLicitacaoIdentity(record) || 'N/A';
    const objectValue = getValue(licitacaoData, ['objeto', 'objeto_compra', 'descricao', 'description', 'titulo']) || 'Objeto não informado';
    const statusValue = getValue(record, ['status'])
      || getValue(record.dados_pncp || record.pncp, ['situacaoCompraNome', 'situacaoCompra'])
      || getValue(licitacaoData, ['status'])
      || 'NÃO INFORMADO';
    const summaryText = getSummaryText(record);
    const editalUrl = getValue(record, ['edital_url', 'url_edital', 'link_edital', 'url', 'href', 'link']) || getValue(record.arquivo, ['url', 'uri', 'href', 'link']) || '';
    const createdAt = formatCreatedAt(record);

    return `
      <article class="licitacao-card ${isOpen ? 'is-open' : ''}" aria-label="Licitação ${escapeHtml(idValue)}">
        <div class="card-heading">
          <div class="summary">
            <div class="summary-top">
              <span class="id-chip"><span class="id-label">ID</span>${escapeHtml(idValue)}</span>
              <span class="status-badge" data-status="${escapeHtml(String(statusValue).trim().toUpperCase())}">${
                String(statusValue).trim().toUpperCase() === 'PENDENTE'
                  ? '<span class="spinner" aria-hidden="true"></span>'
                  : '<span class="status-dot" aria-hidden="true"></span>'
              }${escapeHtml(statusValue)}</span>
              ${createdAt ? `<span class="created-at">&#128339; Criado em ${escapeHtml(createdAt)}</span>` : ''}
            </div>
            ${renderPncpDetails(record)}
            <div class="objet"><strong>Objeto:</strong> ${escapeHtml(objectValue)}</div>
          </div>
          <div class="card-actions">
            <button class="card-toggle" type="button" aria-label="${isOpen ? 'Recolher' : 'Expandir'} detalhes da contratação" aria-expanded="${isOpen}">
              <span class="chevron" aria-hidden="true">${isOpen ? '−' : '+'}</span>
            </button>
            ${record._requiresReport ? '<button class="generate-report-button" type="button">Gerar relatório</button>' : ''}
          </div>
        </div>

        <div class="card-content" ${isOpen ? '' : 'hidden'}>
          <div class="download-actions">
            <span class="actions-label">Downloads</span>
            <div class="download-options" aria-label="Formatos do resumo">
              <button class="download-button word-option" type="button">⬇ Word (.doc)</button>
              <button class="download-button pdf-option" type="button">⬇ PDF (.pdf)</button>
              <a class="download-button edital-button" href="${escapeHtml(editalUrl || '#')}" rel="noopener noreferrer" ${editalUrl ? 'target="_blank"' : ''}>
                ⬇ Edital
              </a>
            </div>
          </div>
          <h3 class="summary-title">Resumo do edital</h3>
          <div class="summary-markdown">${markdownToHtml(summaryText)}</div>
        </div>
      </article>
    `;
  }

  function renderCards(list) {
    cardsContainer.innerHTML = '';

    if (!list || list.length === 0) {
      cardsContainer.innerHTML = `
        <div class="empty-state">
          <p>Nenhuma licitação encontrada.</p>
        </div>
      `;
      return;
    }

    list.forEach((licitacao) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = buildCardTemplate(licitacao);

      const article = wrapper.firstElementChild;
      const toggleButton = article.querySelector('.card-toggle');
      const content = article.querySelector('.card-content');
      const chevron = article.querySelector('.chevron');
      const wordButton = article.querySelector('.word-option');
      const pdfButton = article.querySelector('.pdf-option');
      const editalButton = article.querySelector('.edital-button');
      const generateReportButton = article.querySelector('.generate-report-button');
      const record = normalizeSingleResponse(licitacao);
      const id = getLicitacaoIdentity(record) || 'licitacao';
      const safeId = String(id).replace(/[<>:"/\\|?*]/g, '-');
      const editalUrl = getValue(record, ['edital_url', 'url_edital', 'link_edital', 'url', 'href', 'link']) || getValue(record.arquivo, ['url', 'uri', 'href', 'link']) || '';

      if (!editalUrl) {
        editalButton.classList.add('disabled');
        editalButton.setAttribute('aria-disabled', 'true');
        editalButton.removeAttribute('target');
        editalButton.addEventListener('click', (event) => {
          event.preventDefault();
          setStatus('Nenhum edital disponível para download nesta licitação.', true);
        });
      } else {
        editalButton.addEventListener('click', (event) => {
          if (!window.confirm('Deseja baixar o edital desta licitação?')) {
            event.preventDefault();
          }
        });
      }

      wordButton.addEventListener('click', () => {
        if (!window.confirm(`Deseja baixar o resumo em Word (${safeId}.doc)?`)) {
          return;
        }
        triggerDownload(createDocUrl(record), `${safeId}.doc`);
      });

      pdfButton.addEventListener('click', () => {
        if (!window.confirm(`Deseja baixar o resumo em PDF (${safeId}.pdf)?`)) {
          return;
        }
        downloadPdfFromDocument(record, `${safeId}.pdf`).catch((error) => {
          setStatus(error.message, true);
        });
      });

      toggleButton.addEventListener('click', () => {
        const isOpen = article.classList.contains('is-open');
        article.classList.toggle('is-open', !isOpen);
        toggleButton.setAttribute('aria-expanded', String(!isOpen));
        toggleButton.setAttribute('aria-label', `${isOpen ? 'Expandir' : 'Recolher'} detalhes da contratação`);
        content.hidden = isOpen;
        chevron.textContent = isOpen ? '+' : '−';
      });

      generateReportButton?.addEventListener('click', () => {
        generateReport(record, generateReportButton).catch((error) => {
          generateReportButton.disabled = false;
          generateReportButton.textContent = 'Gerar relatório';
          setStatus(error.message, true);
        });
      });

      cardsContainer.appendChild(article);
    });
  }

  async function loadSavedLicitacoes() {
    try {
      const data = await apiFetch('/licitacoes?page=1&page_size=10', { method: 'GET' });
      const licitacoes = normalizeListResponse(data);
      const storedProcurements = getStoredPncpProcurements();
      renderCards(mergeSavedAndPncpLicitacoes(licitacoes, storedProcurements));
      setStatus(`Licitações salvas carregadas: ${licitacoes.length}.`);
      return true;
    } catch (error) {
      const storedProcurements = getStoredPncpProcurements();
      if (storedProcurements.length) {
        renderCards(storedProcurements);
      }
      setStatus(error.message, true);
      if (!storedProcurements.length) {
        cardsContainer.innerHTML = `
          <div class="empty-state error-state">
            <p>${error.message}</p>
          </div>
        `;
      }
      return false;
    }
  }

  async function searchNewLicitacaoById(rawId) {
    const { id, procurement } = await fetchPncpProcurement(rawId);
    const result = {
      numero_controle_pncp: id,
      objeto: procurement.objeto || procurement.objetoCompra,
      dados_pncp: procurement,
      pncp: procurement,
      licitacao: {
        ...procurement,
        numero_controle_pncp: id,
        objeto: procurement.objeto || procurement.objetoCompra
      },
      _requiresReport: true
    };

    renderCards([result]);
    setStatus(`Contratação ${id} carregada do PNCP. Confira os dados e gere o relatório quando quiser.`);
  }

  async function generateReport(record, button) {
    const licitacaoData = getLicitationRecord(record);
    const idValue = getValue(licitacaoData, ['numero_controle_pncp', 'numeroControlePncp']);
    if (!idValue) {
      throw new Error('Não foi possível identificar o ID da contratação para gerar o relatório.');
    }

    button.disabled = true;
    button.innerHTML = '<span class="spinner" aria-hidden="true"></span>Gerando relatório...';
    setStatus('Enviando os dados da contratação para gerar o relatório...');

    const paths = [
      `/licitacoes/analisar/${encodeURIComponent(idValue)}`,
      `/licitacoes/analisar/${idValue}`
    ];
    let data;

    for (const path of paths) {
      try {
        data = await apiFetch(path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            numero_controle_pncp: idValue,
            dados_pncp: record.dados_pncp || record.pncp,
            licitacao: licitacaoData
          })
        });
        break;
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }
    }

    if (!data) {
      throw new Error(`A API não retornou o relatório da contratação "${idValue}".`);
    }

    const result = normalizeSingleResponse(data);
    if (!result) {
      throw new Error('A API não retornou o relatório da contratação.');
    }

    const pncpData = record.dados_pncp || record.pncp;
    const reportRecord = getLicitationRecord(result);
    saveStoredPncpProcurement({
      ...record,
      ...result,
      numero_controle_pncp: idValue,
      dados_pncp: pncpData,
      pncp: pncpData,
      licitacao: {
        ...getLicitationRecord(record),
        ...reportRecord,
        numero_controle_pncp: idValue
      },
      _requiresReport: false
    });
    setStatus(`Relatório da contratação ${idValue} gerado. Atualizando a página...`);
    window.location.reload();
  }

  searchButton.addEventListener('click', async () => {
    if (searchButton.disabled) {
      return;
    }

    const originalLabel = searchButton.textContent;
    searchButton.disabled = true;
    reloadButton.disabled = true;
    searchButton.textContent = 'Consultando...';
    statusElement.classList.remove('error');
    statusElement.innerHTML = '<span class="spinner" aria-hidden="true"></span>Consultando os dados da contratação no PNCP...';
    cardsContainer.innerHTML = `
      <div class="loading-state" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <p>Buscando os dados do edital no PNCP...</p>
      </div>
    `;

    try {
      await searchNewLicitacaoById(searchInput.value);
    } catch (error) {
      setStatus(error.message, true);
      cardsContainer.innerHTML = `
        <div class="empty-state error-state">
          <p>${error.message}</p>
        </div>
      `;
    } finally {
      searchButton.disabled = false;
      reloadButton.disabled = false;
      searchButton.textContent = originalLabel;
    }
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      searchButton.click();
    }
  });

  let reloadFeedbackTimer;

  reloadButton.addEventListener('click', async () => {
    if (reloadButton.disabled) {
      return;
    }

    clearTimeout(reloadFeedbackTimer);
    const originalLabel = '&#8635; Recarregar';
    reloadButton.disabled = true;
    searchButton.disabled = true;
    reloadButton.innerHTML = '<span class="spinner" aria-hidden="true"></span>Recarregando...';

    const success = await loadSavedLicitacoes();

    reloadButton.disabled = false;
    searchButton.disabled = false;
    reloadButton.innerHTML = success ? '&#10003; Recarregado!' : '&#10007; Falha ao recarregar';
    reloadButton.classList.toggle('success', success);

    reloadFeedbackTimer = setTimeout(() => {
      reloadButton.innerHTML = originalLabel;
      reloadButton.classList.remove('success');
    }, 2000);
  });

  async function startApplication() {
    if (!requireAuthentication()) {
      return;
    }

    try {
      await loadSavedLicitacoes();
    } catch (error) {
      setStatus(error.message, true);
      cardsContainer.innerHTML = `
        <div class="empty-state error-state">
          <p>${error.message}</p>
        </div>
      `;
    }
  }

  startApplication();
});
