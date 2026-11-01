import { apiFetch } from './api.js';
import { requireAuthentication } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
  const cardsContainer = document.getElementById('cards-container');
  const statusElement = document.getElementById('api-status');
  const searchInput = document.getElementById('licitacao-search');
  const searchButton = document.getElementById('licitacao-search-button');
  const reloadButton = document.getElementById('licitacao-reload-button');

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

  function buildCardTemplate(licitacao, isOpen = false) {
    const record = normalizeSingleResponse(licitacao);
    const licitacaoData = getLicitationRecord(record);
    const idValue = getValue(record, ['numero_controle_pncp', 'numeroControlePncp', 'numero', 'id']) || 'N/A';
    const objectValue = getValue(licitacaoData, ['objeto', 'objeto_compra', 'descricao', 'description', 'titulo']) || 'Objeto não informado';
    const statusValue = getValue(record, ['status']) || getValue(licitacaoData, ['status']) || 'NÃO INFORMADO';
    const summaryText = getSummaryText(record);
    const editalUrl = getValue(record, ['edital_url', 'url_edital', 'link_edital', 'url', 'href', 'link']) || getValue(record.arquivo, ['url', 'uri', 'href', 'link']) || '';

    return `
      <article class="licitacao-card ${isOpen ? 'is-open' : ''}" aria-label="Licitação ${idValue}">
        <button class="card-toggle" type="button" aria-expanded="${isOpen}">
          <span class="summary">
            <span>ID: <strong>${idValue}</strong></span>
            <span class="objet">${objectValue}</span>
          </span>
          <span class="chevron" aria-hidden="true">${isOpen ? '−' : '+'}</span>
        </button>

        <div class="card-content" ${isOpen ? '' : 'hidden'}>
          <div class="download-actions">
            <div class="download-options" aria-label="Formatos do resumo">
              <button class="download-button word-option" type="button">⬇ Word (.doc)</button>
              <button class="download-button pdf-option" type="button">⬇ PDF (.pdf)</button>
            </div>
            <a class="download-button edital-button" href="${editalUrl || '#'}" rel="noopener noreferrer" ${editalUrl ? 'target="_blank"' : ''}>
              ⬇ Edital
            </a>
            <span class="status-badge" data-status="${escapeHtml(statusValue)}">Status: ${escapeHtml(statusValue)}</span>
          </div>
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

    list.forEach((licitacao, index) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = buildCardTemplate(licitacao, index === 0);

      const article = wrapper.firstElementChild;
      const toggleButton = article.querySelector('.card-toggle');
      const content = article.querySelector('.card-content');
      const chevron = article.querySelector('.chevron');
      const wordButton = article.querySelector('.word-option');
      const pdfButton = article.querySelector('.pdf-option');
      const editalButton = article.querySelector('.edital-button');
      const record = normalizeSingleResponse(licitacao);
      const id = getValue(getLicitationRecord(record), ['numero_controle_pncp', 'numeroControlePncp', 'numero', 'id']) || 'licitacao';
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
      }

      wordButton.addEventListener('click', () => {
        triggerDownload(createDocUrl(record), `${safeId}.doc`);
      });

      pdfButton.addEventListener('click', () => {
        downloadPdfFromDocument(record, `${safeId}.pdf`).catch((error) => {
          setStatus(error.message, true);
        });
      });

      toggleButton.addEventListener('click', () => {
        const isOpen = article.classList.contains('is-open');
        article.classList.toggle('is-open', !isOpen);
        toggleButton.setAttribute('aria-expanded', String(!isOpen));
        content.hidden = isOpen;
        chevron.textContent = isOpen ? '+' : '−';
      });

      cardsContainer.appendChild(article);
    });
  }

  async function loadSavedLicitacoes() {
    try {
      const data = await apiFetch('/licitacoes?page=1&page_size=10', { method: 'GET' });
      const licitacoes = normalizeListResponse(data);
      renderCards(licitacoes);
      setStatus(`Licitações salvas carregadas: ${licitacoes.length}.`);
    } catch (error) {
      setStatus(error.message, true);
      cardsContainer.innerHTML = `
        <div class="empty-state error-state">
          <p>${error.message}</p>
        </div>
      `;
    }
  }

  async function searchNewLicitacaoById(rawId) {
    const idValue = String(rawId || '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/\s+/g, '');
    if (!idValue) {
      throw new Error('Informe o ID da licitação para buscar uma nova análise.');
    }

    const paths = [
      `/licitacoes/analisar/${encodeURIComponent(idValue)}`,
      `/licitacoes/analisar/${idValue}`
    ];
    let data;
    let lastError;

    for (const path of paths) {
      try {
        data = await apiFetch(path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        break;
      } catch (error) {
        lastError = error;
        if (error.status !== 404) {
          throw error;
        }
      }
    }

    if (!data) {
      throw new Error(`Licitação não encontrada para o ID "${idValue}". Confirme se o valor está no formato completo, por exemplo: 01409580000138-1-001625/2026.`);
    }

    const result = normalizeSingleResponse(data);
    if (!result) {
      throw new Error('A API não retornou a licitação pesquisada.');
    }

    renderCards([result]);
    setStatus(`Licitação ${idValue} carregada com sucesso.`);
  }

  searchButton.addEventListener('click', async () => {
    try {
      await searchNewLicitacaoById(searchInput.value);
    } catch (error) {
      setStatus(error.message, true);
      cardsContainer.innerHTML = `
        <div class="empty-state error-state">
          <p>${error.message}</p>
        </div>
      `;
    }
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      searchButton.click();
    }
  });

  reloadButton.addEventListener('click', loadSavedLicitacoes);

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
