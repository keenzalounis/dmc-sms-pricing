/**
 * DMC SMS Pricing - Logique Front-End
 */

document.addEventListener('DOMContentLoaded', () => {
  // Éléments DOM
  const kpiTotal = document.getElementById('kpi-total');
  const kpiAvg = document.getElementById('kpi-avg');
  const kpiIncreases = document.getElementById('kpi-increases');
  const kpiDate = document.getElementById('kpi-date');
  const searchInput = document.getElementById('search-input');
  const resultsCount = document.getElementById('results-count');
  const pricesTbody = document.getElementById('prices-tbody');
  const btnRefresh = document.getElementById('btn-refresh');

  // Modals
  const modalExport = document.getElementById('modal-export');
  const modalUpload = document.getElementById('modal-upload');
  const modalChart = document.getElementById('modal-chart');
  const modalPythonCharts = document.getElementById('modal-python-charts');
  const modalSinch = document.getElementById('modal-sinch');
  const btnOpenExport = document.getElementById('btn-open-export');
  const btnOpenUpload = document.getElementById('btn-open-upload');
  const btnOpenCharts = document.getElementById('btn-open-charts');
  const btnOpenSinch = document.getElementById('btn-open-sinch');
  const btnTriggerDownload = document.getElementById('btn-trigger-download');
  const btnTriggerPyGenerate = document.getElementById('btn-trigger-py-generate');
  const pyChartsGallery = document.getElementById('py-charts-gallery');
  const pyGenerateStatus = document.getElementById('py-generate-status');
  const exportMarginInput = document.getElementById('export-margin');
  const exportCountryInput = document.getElementById('export-country');

  // Sinch Modal elements
  const sinchStatusBadge = document.getElementById('sinch-status-badge');
  const sinchStatusPlan = document.getElementById('sinch-status-plan');
  const sinchStatusUrl = document.getElementById('sinch-status-url');
  const sinchStatusLastDate = document.getElementById('sinch-status-last-date');
  const sinchForceMock = document.getElementById('sinch-force-mock');
  const sinchSyncResult = document.getElementById('sinch-sync-result');
  const btnTriggerSinchSync = document.getElementById('btn-trigger-sinch-sync');
  const btnToggleSinchConfig = document.getElementById('btn-toggle-sinch-config');
  const sinchConfigSection = document.getElementById('sinch-config-section');
  const cfgServicePlanId = document.getElementById('cfg-service-plan-id');
  const cfgApiToken = document.getElementById('cfg-api-token');
  const cfgBaseUrl = document.getElementById('cfg-base-url');
  const btnSaveSinchConfig = document.getElementById('btn-save-sinch-config');
  const sinchConfigStatus = document.getElementById('sinch-config-status');

  // Upload
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileSelectedName = document.getElementById('file-selected-name');
  const btnSendUpload = document.getElementById('btn-send-upload');
  const uploadStatus = document.getElementById('upload-status');
  let selectedFileContent = null;

  // Chart modal
  const chartTitle = document.getElementById('chart-title');
  const chartSubtitle = document.getElementById('chart-subtitle');
  const priceCanvas = document.getElementById('price-canvas');
  const historyTbody = document.getElementById('history-tbody');

  // --- Initialisation ---
  loadKPIs();
  loadPrices();

  // --- Gestionnaires d'événements ---
  btnRefresh.addEventListener('click', () => {
    loadKPIs();
    loadPrices(searchInput.value);
  });

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      loadPrices(searchInput.value);
    }, 250);
  });

  // Modals Open / Close
  btnOpenExport.addEventListener('click', () => openModal(modalExport));
  btnOpenUpload.addEventListener('click', () => {
    resetUploadModal();
    openModal(modalUpload);
  });
  btnOpenCharts.addEventListener('click', () => {
    openModal(modalPythonCharts);
    loadPythonCharts();
  });
  btnOpenSinch.addEventListener('click', () => {
    openModal(modalSinch);
    loadSinchStatus();
  });

  btnToggleSinchConfig.addEventListener('click', () => {
    sinchConfigSection.style.display = sinchConfigSection.style.display === 'none' ? 'block' : 'none';
  });

  async function loadSinchStatus() {
    try {
      const res = await fetch('/api/sinch/status');
      const data = await res.json();
      if (data.configured) {
        sinchStatusBadge.className = 'badge badge-success';
        sinchStatusBadge.textContent = '● En direct Sinch API';
      } else {
        sinchStatusBadge.className = 'badge badge-warning';
        sinchStatusBadge.textContent = '○ Bac à sable / Mock actif';
      }
      sinchStatusPlan.textContent = data.servicePlanId || 'Non configuré';
      sinchStatusUrl.textContent = data.baseUrl || 'https://sms.api.sinch.com';
      sinchStatusLastDate.textContent = data.lastSyncDate
        ? new Date(data.lastSyncDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Jamais synchronisé';
      if (cfgBaseUrl && !cfgBaseUrl.value) cfgBaseUrl.value = data.baseUrl || '';
    } catch (err) {
      sinchStatusBadge.className = 'badge badge-danger';
      sinchStatusBadge.textContent = 'Erreur statut';
    }
  }

  btnSaveSinchConfig.addEventListener('click', async () => {
    btnSaveSinchConfig.disabled = true;
    sinchConfigStatus.style.display = 'none';
    try {
      const payload = {
        servicePlanId: cfgServicePlanId.value,
        apiToken: cfgApiToken.value,
        baseUrl: cfgBaseUrl.value
      };
      const res = await fetch('/api/sinch/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        sinchConfigStatus.className = 'alert alert-success';
        sinchConfigStatus.textContent = 'Identifiants enregistrés avec succès !';
        sinchConfigStatus.style.display = 'block';
        loadSinchStatus();
      } else {
        sinchConfigStatus.className = 'alert alert-danger';
        sinchConfigStatus.textContent = data.message || 'Erreur lors de la sauvegarde';
        sinchConfigStatus.style.display = 'block';
      }
    } catch (err) {
      sinchConfigStatus.className = 'alert alert-danger';
      sinchConfigStatus.textContent = `Erreur réseau : ${err.message}`;
      sinchConfigStatus.style.display = 'block';
    } finally {
      btnSaveSinchConfig.disabled = false;
    }
  });

  btnTriggerSinchSync.addEventListener('click', async () => {
    btnTriggerSinchSync.disabled = true;
    btnTriggerSinchSync.textContent = '⏳ Synchronisation en cours...';
    sinchSyncResult.style.display = 'none';

    try {
      const res = await fetch('/api/sinch/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceMock: sinchForceMock.checked })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const d = data.details;
        sinchSyncResult.className = 'alert alert-success';
        sinchSyncResult.innerHTML = `
          <strong>Synchronisation réussie !</strong><br>
          • Source : <code>${escapeHTML(d.source)}</code><br>
          • Destinations reçues : <strong>${d.totalFetched}</strong><br>
          • Nouvelles destinations : <strong>${d.countCreated}</strong> | Mises à jour : <strong>${d.countUpdated}</strong> | Inchangées : <strong>${d.countUnchanged}</strong>
        `;
        sinchSyncResult.style.display = 'block';

        // Recharger les données du tableau et KPIs
        loadKPIs();
        loadPrices(searchInput.value);
        loadSinchStatus();
      } else {
        sinchSyncResult.className = 'alert alert-danger';
        sinchSyncResult.textContent = data.message || 'Échec de la synchronisation';
        sinchSyncResult.style.display = 'block';
      }
    } catch (err) {
      sinchSyncResult.className = 'alert alert-danger';
      sinchSyncResult.textContent = `Erreur réseau : ${err.message}`;
      sinchSyncResult.style.display = 'block';
    } finally {
      btnTriggerSinchSync.disabled = false;
      btnTriggerSinchSync.textContent = '🔄 Lancer la Synchronisation';
    }
  });

  btnTriggerPyGenerate.addEventListener('click', async () => {
    btnTriggerPyGenerate.disabled = true;
    btnTriggerPyGenerate.textContent = 'Génération en cours...';
    pyGenerateStatus.style.display = 'none';

    try {
      const res = await fetch('/api/charts/generate', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        pyGenerateStatus.className = 'alert alert-success';
        pyGenerateStatus.textContent = 'Graphiques Python régénérés avec succès !';
        pyGenerateStatus.style.display = 'block';
        loadPythonCharts();
      } else {
        pyGenerateStatus.className = 'alert alert-danger';
        pyGenerateStatus.textContent = data.message || 'Erreur lors de la génération Python';
        pyGenerateStatus.style.display = 'block';
      }
    } catch (err) {
      pyGenerateStatus.className = 'alert alert-danger';
      pyGenerateStatus.textContent = `Erreur réseau : ${err.message}`;
      pyGenerateStatus.style.display = 'block';
    } finally {
      btnTriggerPyGenerate.disabled = false;
      btnTriggerPyGenerate.textContent = '⚡ Régénérer les graphiques avec Python';
    }
  });

  async function loadPythonCharts() {
    pyChartsGallery.innerHTML = '<p class="text-center text-muted">Recherche des graphiques générés...</p>';
    try {
      const res = await fetch('/api/charts/list');
      const { charts } = await res.json();

      if (!charts || charts.length === 0) {
        pyChartsGallery.innerHTML = `
          <div class="alert alert-info">
            Aucun graphique Python n'a encore été généré. Cliquez sur le bouton ci-dessus pour lancer le script Python (nécessite Python 3 avec pandas & matplotlib).
          </div>
        `;
        return;
      }

      pyChartsGallery.innerHTML = charts.map(c => `
        <div class="py-chart-card" style="background:#FFFFFF; border:1px solid #E2E6EC; border-radius:8px; padding:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h4 style="margin:0; font-size:14px; color:#1C2024;">${escapeHTML(c.title)}</h4>
            <a href="${c.url}" download="${c.name}" class="btn btn-ghost btn-sm">💾 Télécharger HD</a>
          </div>
          <img src="${c.url}?t=${Date.now()}" alt="${escapeHTML(c.title)}" style="width:100%; height:auto; border-radius:6px; border:1px solid #E2E6EC; display:block;">
        </div>
      `).join('');
    } catch (err) {
      pyChartsGallery.innerHTML = `<p class="text-center text-danger">Erreur : ${err.message}</p>`;
    }
  }

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-close');
      closeModal(document.getElementById(targetId));
    });
  });

  window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
      closeModal(e.target);
    }
  });

  // Téléchargement Facturation
  btnTriggerDownload.addEventListener('click', () => {
    const margin = parseFloat(exportMarginInput.value) || 0;
    const country = encodeURIComponent(exportCountryInput.value.trim());
    let url = `/api/export?margin=${margin}`;
    if (country) url += `&country=${country}`;

    window.location.href = url;
    closeModal(modalExport);
  });

  // Upload Drag & Drop
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
  });

  function handleFile(file) {
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
      showUploadStatus('Veuillez sélectionner un fichier CSV ou TXT.', 'danger');
      return;
    }
    fileSelectedName.textContent = `Fichier prêt : ${file.name} (${(file.size / 1024).toFixed(1)} Ko)`;
    btnSendUpload.disabled = false;

    const reader = new FileReader();
    reader.onload = (e) => {
      selectedFileContent = e.target.result;
    };
    reader.readAsText(file);
  }

  btnSendUpload.addEventListener('click', async () => {
    if (!selectedFileContent) return;
    btnSendUpload.disabled = true;
    btnSendUpload.textContent = 'Ingestion en cours...';

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: selectedFileContent
      });
      const data = await res.json();

      if (res.ok) {
        showUploadStatus(`Succès : ${data.details.countCreated} créés, ${data.details.countUpdated} mis à jour. Total actif : ${data.details.total}`, 'success');
        loadKPIs();
        loadPrices(searchInput.value);
        setTimeout(() => { closeModal(modalUpload); }, 1800);
      } else {
        showUploadStatus(`Erreur : ${data.message}`, 'danger');
        btnSendUpload.disabled = false;
        btnSendUpload.textContent = "Lancer l'ingestion";
      }
    } catch (err) {
      showUploadStatus(`Erreur réseau : ${err.message}`, 'danger');
      btnSendUpload.disabled = false;
      btnSendUpload.textContent = "Lancer l'ingestion";
    }
  });

  function resetUploadModal() {
    fileSelectedName.textContent = '';
    btnSendUpload.disabled = true;
    btnSendUpload.textContent = "Lancer l'ingestion";
    uploadStatus.style.display = 'none';
    selectedFileContent = null;
    fileInput.value = '';
  }

  function showUploadStatus(msg, type) {
    uploadStatus.className = `alert alert-${type}`;
    uploadStatus.textContent = msg;
    uploadStatus.style.display = 'block';
  }

  function openModal(m) { m.classList.add('active'); }
  function closeModal(m) { m.classList.remove('active'); }

  // --- Chargement des KPIs ---
  async function loadKPIs() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      kpiTotal.textContent = data.totalDestinations || 0;
      kpiAvg.textContent = `${(data.averagePriceEUR || 0).toFixed(4)} €`;
      kpiIncreases.textContent = data.totalIncreases || 0;
      kpiDate.textContent = data.lastUpdated ? new Date(data.lastUpdated).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Aucune';
    } catch (err) {
      console.error('Erreur chargement stats:', err);
    }
  }

  // --- Chargement de la table des prix ---
  async function loadPrices(query = '') {
    try {
      let url = '/api/prices';
      if (query.trim()) url += `?q=${encodeURIComponent(query.trim())}`;

      const res = await fetch(url);
      const { count, data } = await res.json();

      resultsCount.textContent = `${count} destination${count > 1 ? 's' : ''}`;

      if (!data || data.length === 0) {
        pricesTbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">Aucune destination trouvée pour cette recherche.</td></tr>`;
        return;
      }

      pricesTbody.innerHTML = data.map(r => {
        let badgeHtml = '<span class="badge badge-neutral">Stable</span>';
        if (r.priceChange > 0) {
          badgeHtml = `<span class="badge badge-danger">▲ +${r.percentChange}% (+${r.priceChange.toFixed(4)}€)</span>`;
        } else if (r.priceChange < 0) {
          badgeHtml = `<span class="badge badge-success">▼ ${r.percentChange}% (${r.priceChange.toFixed(4)}€)</span>`;
        }

        return `
          <tr>
            <td><strong>${escapeHTML(r.country)}</strong></td>
            <td>${escapeHTML(r.operator)}</td>
            <td><span class="badge-code">${escapeHTML(r.cc || '-')}</span></td>
            <td><span class="badge-code">${escapeHTML(r.mcc || '-')}/${escapeHTML(r.mnc || '-')}</span></td>
            <td class="mono"><strong>${r.currentPrice.toFixed(5)} €</strong></td>
            <td class="mono text-muted">${r.previousPrice ? r.previousPrice.toFixed(5) + ' €' : '-'}</td>
            <td>${badgeHtml}</td>
            <td>${r.validFrom || '-'}</td>
            <td>
              <button class="btn btn-ghost btn-sm" onclick="showHistory('${r.id}')">
                📈 Graphe
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      pricesTbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger">Erreur de chargement : ${err.message}</td></tr>`;
    }
  }

  // Expose globalement pour les boutons onclick
  window.showHistory = async function(recordId) {
    try {
      const res = await fetch(`/api/history?id=${encodeURIComponent(recordId)}`);
      const data = await res.json();

      chartTitle.textContent = `${data.country} - ${data.operator}`;
      chartSubtitle.textContent = `Indicatif ${data.cc} | Tarif actuel en vigueur : ${data.currentPrice.toFixed(5)} € HT / SMS`;

      // Tableau d'historique
      historyTbody.innerHTML = (data.history || []).map(h => {
        const oldP = h.oldPrice !== undefined ? `${h.oldPrice.toFixed(5)} €` : '-';
        const newP = `${h.price.toFixed(5)} €`;
        const diff = h.oldPrice !== undefined ? (h.price - h.oldPrice) : 0;
        let evo = '<span class="badge badge-neutral">Base</span>';
        if (diff > 0) evo = `<span class="badge badge-danger">+${diff.toFixed(4)} €</span>`;
        else if (diff < 0) evo = `<span class="badge badge-success">${diff.toFixed(4)} €</span>`;

        return `
          <tr>
            <td><strong>${h.date}</strong></td>
            <td class="mono">${oldP}</td>
            <td class="mono"><strong>${newP}</strong></td>
            <td>${evo}</td>
            <td class="text-muted"><small>${escapeHTML(h.source || '-')}</small></td>
          </tr>
        `;
      }).join('');

      // Tracer le graphe sur Canvas
      drawCanvasChart(data.history || []);
      openModal(modalChart);
    } catch (err) {
      alert(`Erreur historique : ${err.message}`);
    }
  };

  // --- Moteur de tracé Canvas autonome pour les courbes ---
  function drawCanvasChart(history) {
    const ctx = priceCanvas.getContext('2d');
    const width = priceCanvas.width;
    const height = priceCanvas.height;

    // Nettoyer
    ctx.clearRect(0, 0, width, height);

    if (history.length === 0) {
      ctx.fillStyle = '#8892A0';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Aucun historique disponible', width / 2, height / 2);
      return;
    }

    // Marges
    const padLeft = 65;
    const padRight = 35;
    const padTop = 30;
    const padBottom = 45;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    // Min et Max prix
    const prices = history.map(h => h.price);
    let minP = Math.min(...prices);
    let maxP = Math.max(...prices);

    // Padding vertical de sécurité
    if (minP === maxP) {
      minP = minP * 0.8;
      maxP = maxP * 1.2;
    } else {
      const margin = (maxP - minP) * 0.2;
      minP = Math.max(0, minP - margin);
      maxP = maxP + margin;
    }

    // Quadrillage horizontal & labels Y
    const steps = 4;
    ctx.strokeStyle = '#E2E6EC';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#606873';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';

    for (let i = 0; i <= steps; i++) {
      const val = minP + ((maxP - minP) / steps) * i;
      const y = padTop + chartH - (i / steps) * chartH;

      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();

      ctx.fillText(`${val.toFixed(4)} €`, padLeft - 8, y + 4);
    }

    // Coordonnées des points
    const points = history.map((h, idx) => {
      const x = history.length === 1
        ? padLeft + chartW / 2
        : padLeft + (idx / (history.length - 1)) * chartW;
      const y = padTop + chartH - ((h.price - minP) / (maxP - minP)) * chartH;
      return { x, y, price: h.price, date: h.date };
    });

    // Remplissage sous la courbe (dégradé SFR Red)
    if (points.length > 1) {
      const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
      gradient.addColorStop(0, 'rgba(226, 0, 26, 0.25)');
      gradient.addColorStop(1, 'rgba(226, 0, 26, 0.0)');

      ctx.beginPath();
      ctx.moveTo(points[0].x, padTop + chartH);
      points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(points[points.length - 1].x, padTop + chartH);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Ligne principale de la courbe
    ctx.beginPath();
    ctx.strokeStyle = '#E2001A';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    points.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Dessin des points et labels
    points.forEach(p => {
      // Point blanc cerclé de rouge
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#E2001A';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Label prix au-dessus
      ctx.fillStyle = '#1C2024';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.price.toFixed(4)} €`, p.x, p.y - 10);

      // Label date sous l'axe X
      ctx.fillStyle = '#606873';
      ctx.font = '10px sans-serif';
      ctx.fillText(p.date, p.x, padTop + chartH + 18);
    });
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
});
