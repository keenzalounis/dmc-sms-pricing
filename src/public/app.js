/**
 * DMC SMS Pricing - Logique Front-End
 */

document.addEventListener('DOMContentLoaded', () => {
  // Support transparent du Reverse Proxy (racine ou sous-chemin comme /dmc/)
  const basePath = window.location.pathname.replace(/\/index\.html$/i, '').replace(/\/+$/, '') + '/';
  function apiUrl(endpoint) {
    return basePath + endpoint.replace(/^\//, '');
  }

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
  const modalArchives = document.getElementById('modal-archives');
  const btnOpenExport = document.getElementById('btn-open-export');
  const btnOpenUpdate = document.getElementById('btn-open-update');
  const btnOpenArchives = document.getElementById('btn-open-archives');
  const btnOpenCharts = document.getElementById('btn-open-charts');
  const btnTriggerDownload = document.getElementById('btn-trigger-download');
  const btnTriggerPyGenerate = document.getElementById('btn-trigger-py-generate');
  const pyChartsGallery = document.getElementById('py-charts-gallery');
  const pyGenerateStatus = document.getElementById('py-generate-status');
  const exportMarginInput = document.getElementById('export-margin');
  const exportCountryInput = document.getElementById('export-country');

  // Upload
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileSelectedName = document.getElementById('file-selected-name');
  const btnSendUpload = document.getElementById('btn-send-upload');
  const uploadStatus = document.getElementById('upload-status');
  const mailSyncInfo = document.getElementById('mail-sync-info');
  const mailSyncStatus = document.getElementById('mail-sync-status');
  const btnTriggerMailSync = document.getElementById('btn-trigger-mail-sync');
  let selectedFileContent = null;
  let selectedFileName = '';

  // Price history modal
  const chartTitle = document.getElementById('chart-title');
  const chartSubtitle = document.getElementById('chart-subtitle');
  const historyTbody = document.getElementById('history-tbody');

  // --- Initialisation ---
  loadKPIs();
  loadPrices();

  // Auto-rafraîchissement discret toutes les 30 secondes en arrière-plan
  setInterval(() => {
    loadKPIs();
    if (!searchInput.value.trim()) {
      loadPrices();
    }
  }, 30000);

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
  btnOpenUpdate.addEventListener('click', () => {
    resetUploadModal();
    openModal(modalUpload);
    loadMailSyncStatus();
  });

  if (btnTriggerMailSync) {
    btnTriggerMailSync.addEventListener('click', async () => {
      btnTriggerMailSync.disabled = true;
      btnTriggerMailSync.textContent = 'Relève en cours...';
      if (mailSyncStatus) mailSyncStatus.style.display = 'none';

      try {
        const res = await fetch(apiUrl('/api/mail/sync'), { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          if (mailSyncStatus) {
            mailSyncStatus.className = 'alert alert-success';
            let msg = data.message;
            if (data.stats && data.stats.csvProcessed > 0) {
              msg += ` (${data.stats.csvProcessed} fichier(s) CSV intégré(s))`;
              loadKPIs();
              loadPrices(searchInput.value);
              loadArchives();
            }
            mailSyncStatus.textContent = msg;
            mailSyncStatus.style.display = 'block';
          }
        } else {
          if (mailSyncStatus) {
            mailSyncStatus.className = 'alert alert-danger';
            mailSyncStatus.textContent = data.message || 'Échec de la relève de la boîte mail.';
            mailSyncStatus.style.display = 'block';
          }
        }
      } catch (err) {
        if (mailSyncStatus) {
          mailSyncStatus.className = 'alert alert-danger';
          mailSyncStatus.textContent = `Erreur : ${err.message}`;
          mailSyncStatus.style.display = 'block';
        }
      } finally {
        btnTriggerMailSync.disabled = false;
        btnTriggerMailSync.textContent = '🔄 Tester la relève maintenant';
      }
    });
  }

  async function loadMailSyncStatus() {
    if (!mailSyncInfo) return;
    if (mailSyncStatus) mailSyncStatus.style.display = 'none';
    try {
      const res = await fetch(apiUrl('/api/mail/status'));
      const data = await res.json();
      if (!data.configured) {
        mailSyncInfo.innerHTML = '⚠️ Boîte mail non configurée dans <code>data/mail_config.json</code>.';
        if (btnTriggerMailSync) btnTriggerMailSync.disabled = true;
      } else {
        const nextDate = data.nextRun ? new Date(data.nextRun).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '02:00';
        mailSyncInfo.innerHTML = `Compte : <strong>${escapeHTML(data.user)}</strong> • Prochaine relève : <strong>${nextDate}</strong>`;
        if (btnTriggerMailSync) btnTriggerMailSync.disabled = false;
      }
    } catch (err) {
      mailSyncInfo.textContent = 'Impossible de charger l\'état de la boîte mail.';
    }
  }
  btnOpenArchives.addEventListener('click', () => {
    openModal(modalArchives);
    loadArchives();
  });
  btnOpenCharts.addEventListener('click', () => {
    openModal(modalPythonCharts);
    loadPythonCharts();
  });
  btnTriggerPyGenerate.addEventListener('click', async () => {
    btnTriggerPyGenerate.disabled = true;
    btnTriggerPyGenerate.textContent = 'Génération en cours…';
    pyGenerateStatus.style.display = 'none';

    try {
      const res = await fetch(apiUrl('/api/charts/generate'), { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        pyGenerateStatus.className = 'alert alert-success';
        pyGenerateStatus.textContent = 'Graphiques Python régénérés avec succès !';
        pyGenerateStatus.style.display = 'block';
        loadPythonCharts();
      } else {
        pyGenerateStatus.className = 'alert alert-danger';
        pyGenerateStatus.textContent = [data.message, data.details].filter(Boolean).join(' ');
        pyGenerateStatus.style.display = 'block';
      }
    } catch (err) {
      pyGenerateStatus.className = 'alert alert-danger';
      pyGenerateStatus.textContent = `Erreur réseau : ${err.message}`;
      pyGenerateStatus.style.display = 'block';
    } finally {
      btnTriggerPyGenerate.disabled = false;
      btnTriggerPyGenerate.textContent = 'Générer les graphiques';
    }
  });

  async function loadPythonCharts() {
    pyChartsGallery.innerHTML = '<p class="text-center text-muted">Recherche des graphiques générés...</p>';
    try {
      const res = await fetch(apiUrl('/api/charts/list'));
      if (!res.ok) throw new Error('Impossible de charger la liste des graphiques');
      const { charts } = await res.json();

      if (!charts || charts.length === 0) {
        pyChartsGallery.innerHTML = `
          <div class="alert alert-info">
            Aucun graphique n'est encore disponible. Générez-les avec Python 3 et les dépendances de <code>requirements.txt</code> installées sur ce serveur.
          </div>
        `;
        return;
      }

      pyChartsGallery.innerHTML = charts.map(c => `
        <article class="py-chart-card">
          <div class="py-chart-card-header">
            <h4>${escapeHTML(c.title)}</h4>
            <a href="${apiUrl(c.url)}" download="${escapeHTML(c.name)}" class="btn btn-ghost btn-sm">Télécharger</a>
          </div>
          <img src="${apiUrl(c.url)}?t=${Date.now()}" alt="${escapeHTML(c.title)}" loading="lazy">
        </article>
      `).join('');
    } catch (err) {
      pyChartsGallery.innerHTML = `<p class="text-center text-danger">Erreur : ${err.message}</p>`;
    }
  }

  async function loadArchives() {
    const archivesTbody = document.getElementById('archives-tbody');
    archivesTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Chargement...</td></tr>';
    try {
      const res = await fetch(apiUrl('/api/archives'));
      if (!res.ok) throw new Error('Impossible de charger les archives');
      const { archives } = await res.json();
      if (!archives.length) {
        archivesTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Aucune version archivée pour le moment.</td></tr>';
        return;
      }
      archivesTbody.innerHTML = archives.map(archive => `
        <tr>
          <td>${new Date(archive.archivedAt).toLocaleString('fr-FR')}</td>
          <td>${escapeHTML(archive.source)}</td>
          <td>${archive.totalDestinations}</td>
          <td style="white-space: nowrap;">
            <a class="btn btn-ghost btn-sm" href="${apiUrl('/api/archives/' + encodeURIComponent(archive.filename))}" download title="Télécharger cette archive">Télécharger</a>
            <button class="btn btn-ghost btn-sm" style="color: #DC2626;" onclick="deleteArchive('${escapeHTML(archive.filename)}')" title="Supprimer cette archive">🗑️ Supprimer</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      archivesTbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">${escapeHTML(err.message)}</td></tr>`;
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

    window.location.href = apiUrl(url);
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
    if (!/\.(csv|txt)$/i.test(file.name)) {
      showUploadStatus('Veuillez sélectionner un fichier CSV ou TXT.', 'danger');
      return;
    }
    selectedFileName = file.name;
    fileSelectedName.textContent = `Fichier prêt : ${file.name} (${(file.size / 1024).toFixed(1)} Ko)`;
    btnSendUpload.disabled = true;

    const reader = new FileReader();
    reader.onload = (e) => {
      selectedFileContent = e.target.result;
      btnSendUpload.disabled = false;
    };
    reader.onerror = () => {
      selectedFileContent = null;
      showUploadStatus('Impossible de lire ce fichier.', 'danger');
    };
    reader.readAsText(file);
  }

  btnSendUpload.addEventListener('click', async () => {
    if (!selectedFileContent) return;
    btnSendUpload.disabled = true;
    btnSendUpload.textContent = 'Ingestion en cours...';

    try {
      const res = await fetch(apiUrl('/api/upload'), {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'X-File-Name': encodeURIComponent(selectedFileName)
        },
        body: selectedFileContent
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showUploadStatus(`Succès : ${data.details.countCreated} créés, ${data.details.countUpdated} mis à jour. Total actif : ${data.details.total}`, 'success');
        loadKPIs();
        loadPrices(searchInput.value);
        loadArchives();
        setTimeout(() => { closeModal(modalUpload); }, 1800);
      } else {
        const details = Array.isArray(data.details) ? data.details.join(' ') : '';
        showUploadStatus(`Erreur : ${data.message}${details ? ` ${details}` : ''}`, 'danger');
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
    selectedFileName = '';
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
      const res = await fetch(apiUrl('/api/stats'));
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

      const res = await fetch(apiUrl(url));
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
                Historique
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
      const res = await fetch(apiUrl(`/api/history?id=${encodeURIComponent(recordId)}`));
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

      openModal(modalChart);
    } catch (err) {
      alert(`Erreur historique : ${err.message}`);
    }
  };

  // Réinitialisation au catalogue de base (remise à 0 des hausses)
  const btnResetBase = document.getElementById('btn-reset-base');
  if (btnResetBase) {
    btnResetBase.addEventListener('click', async () => {
      const confirmed = confirm(
        "Êtes-vous sûr de vouloir réinitialiser la base au catalogue officiel Sinch ?\n\n" +
        "- Toutes les hausses et baisses récentes seront remises à 0.\n" +
        "- Les 930 tarifs officiels du catalogue de base seront restaurés.\n" +
        "- Le fichier de base officiel est protégé et ne sera pas altéré."
      );
      if (!confirmed) return;

      btnResetBase.disabled = true;
      btnResetBase.textContent = "Réinitialisation en cours...";

      try {
        const res = await fetch(apiUrl('/api/reset-base'), { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          loadKPIs();
          loadPrices();
          loadArchives();
          alert("✓ Base réinitialisée avec succès ! Les hausses et baisses ont été remises à 0.");
        } else {
          alert("Erreur lors de la réinitialisation : " + (data.message || 'Échec'));
        }
      } catch (err) {
        alert("Erreur réseau : " + err.message);
      } finally {
        btnResetBase.disabled = false;
        btnResetBase.textContent = "↺ Réinitialiser au catalogue de base (Remise à 0)";
      }
    });
  }

  // Suppression d'une archive
  window.deleteArchive = async function(filename) {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer définitivement cette version archivée ?\n\nFichier : ${filename}`)) {
      return;
    }
    try {
      const res = await fetch(apiUrl('/api/archives/' + encodeURIComponent(filename)), {
        method: 'DELETE'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        loadKPIs();
        loadPrices();
        loadArchives();
      } else {
        alert('Erreur : ' + (data.message || 'Impossible de supprimer cette archive.'));
      }
    } catch (err) {
      alert('Erreur réseau lors de la suppression : ' + err.message);
    }
  };

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
