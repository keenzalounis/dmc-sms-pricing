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
  const kpiDecreases = document.getElementById('kpi-decreases');
  const kpiDate = document.getElementById('kpi-date');
  const searchInput = document.getElementById('search-input');
  const resultsCount = document.getElementById('results-count');
  const pricesTbody = document.getElementById('prices-tbody');
  const btnRefresh = document.getElementById('btn-refresh');

  // Éléments Authentification & Utilisateurs
  const viewLogin = document.getElementById('view-login');
  const viewApp = document.getElementById('view-app');
  const formLogin = document.getElementById('form-login');
  const loginEmail = document.getElementById('login-email');
  const loginPassword = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const btnLoginSubmit = document.getElementById('btn-login-submit');

  const userDisplayName = document.getElementById('user-display-name');
  const userDisplayRole = document.getElementById('user-display-role');
  const btnLogout = document.getElementById('btn-logout');
  const btnOpenAccount = document.getElementById('btn-open-account');
  const modalAccount = document.getElementById('modal-account');
  const usersCountBadge = document.getElementById('users-count-badge');
  const profileUserName = document.getElementById('profile-user-name');
  const profileUserEmail = document.getElementById('profile-user-email');
  const profileUserRole = document.getElementById('profile-user-role');
  const profileUserPerms = document.getElementById('profile-user-perms');
  const usersTbody = document.getElementById('users-tbody');
  const formCreateUser = document.getElementById('form-create-user');
  const userCreateStatus = document.getElementById('user-create-status');
  const formChangePassword = document.getElementById('form-change-password');
  const pwdChangeStatus = document.getElementById('pwd-change-status');

  let currentUser = null;

  // Modals
  const modalExport = document.getElementById('modal-export');
  const modalUpload = document.getElementById('modal-upload');
  const modalChart = document.getElementById('modal-chart');
  const modalArchives = document.getElementById('modal-archives');
  const btnOpenExport = document.getElementById('btn-open-export');
  const btnOpenUpdate = document.getElementById('btn-open-update');
  const btnOpenArchives = document.getElementById('btn-open-archives');
  const btnTriggerDownload = document.getElementById('btn-trigger-download');
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
  const operatorPriceChart = document.getElementById('operator-price-chart');
  const chartPointsCount = document.getElementById('chart-points-count');
  const chartLegendInfo = document.getElementById('chart-legend-info');

  // --- Initialisation : Vérification de la session active ---
  checkAuth();

  // Auto-rafraîchissement discret toutes les 30 secondes en arrière-plan
  setInterval(() => {
    if (!currentUser) return;
    loadKPIs();
    if (!searchInput.value.trim()) {
      loadPrices();
    }
  }, 30000);

  // --- LOGIQUE D'AUTHENTIFICATION & SESSIONS ---

  async function checkAuth() {
    try {
      const res = await fetch(apiUrl('/api/auth/me'));
      const data = await res.json();
      if (data.authenticated && data.user) {
        initAppSession(data.user);
      } else {
        showLoginScreen();
      }
    } catch (err) {
      showLoginScreen();
    }
  }

  function showLoginScreen() {
    currentUser = null;
    if (viewLogin) viewLogin.style.display = 'flex';
    if (viewApp) viewApp.style.display = 'none';
    if (loginPassword) loginPassword.value = '';
    if (loginError) loginError.style.display = 'none';
  }

  function initAppSession(user) {
    currentUser = user;
    if (viewLogin) viewLogin.style.display = 'none';
    if (viewApp) viewApp.style.display = 'block';

    if (userDisplayName) userDisplayName.textContent = user.name || user.email;
    if (userDisplayRole) {
      userDisplayRole.textContent = user.role === 'admin' ? 'Admin' : 'Facturation';
      userDisplayRole.className = user.role === 'admin' ? 'badge badge-danger' : 'badge badge-neutral';
    }

    if (profileUserName) profileUserName.textContent = user.name || '-';
    if (profileUserEmail) profileUserEmail.textContent = user.email || '-';
    if (profileUserRole) profileUserRole.textContent = user.role === 'admin' ? 'Administrateur (Accès total)' : 'Facturation (Consultation & Export)';
    if (profileUserPerms) profileUserPerms.textContent = user.role === 'admin' ? 'Accès complet (Gestion tarifs, relève mail, gestion comptes)' : 'Consultation, recherche et export facturation';

    // Gestion des droits selon le rôle (Admin vs Facturation)
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = user.role === 'admin' ? '' : 'none';
    });

    loadKPIs();
    loadPrices();
  }

  function switchAccountTab(tabId) {
    document.querySelectorAll('.account-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.account-tab-pane').forEach(pane => {
      pane.style.display = pane.id === tabId ? 'block' : 'none';
    });
  }

  if (btnOpenAccount && modalAccount) {
    btnOpenAccount.addEventListener('click', () => {
      if (userCreateStatus) userCreateStatus.style.display = 'none';
      if (pwdChangeStatus) pwdChangeStatus.style.display = 'none';
      if (formCreateUser) formCreateUser.reset();
      if (formChangePassword) formChangePassword.reset();

      openModal(modalAccount);
      if (currentUser && currentUser.role === 'admin') {
        switchAccountTab('pane-users-list');
        loadUsersList();
      } else {
        switchAccountTab('pane-profile');
      }
    });
  }

  document.querySelectorAll('.account-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchAccountTab(targetTab);
      if (targetTab === 'pane-users-list') {
        loadUsersList();
      }
    });
  });

  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = loginEmail.value.trim();
      const password = loginPassword.value;
      if (!email || !password) return;

      btnLoginSubmit.disabled = true;
      btnLoginSubmit.textContent = 'Connexion en cours...';
      if (loginError) loginError.style.display = 'none';

      try {
        const res = await fetch(apiUrl('/api/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          initAppSession(data.user);
        } else {
          if (loginError) {
            loginError.textContent = data.message || 'Identifiants incorrects.';
            loginError.style.display = 'block';
          }
        }
      } catch (err) {
        if (loginError) {
          loginError.textContent = `Erreur réseau : ${err.message}`;
          loginError.style.display = 'block';
        }
      } finally {
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.textContent = 'Se connecter';
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await fetch(apiUrl('/api/auth/logout'), { method: 'POST' });
      } catch (e) {}
      showLoginScreen();
    });
  }

  // --- GESTION DES COMPTES COLLABORATEURS (ADMIN) ---

  async function loadUsersList() {
    if (!usersTbody) return;
    usersTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Chargement des comptes...</td></tr>';
    try {
      const res = await fetch(apiUrl('/api/users'));
      const data = await res.json();
      if (!res.ok || !data.users) throw new Error(data.message || 'Erreur');

      if (usersCountBadge && data.users) {
        usersCountBadge.textContent = `${data.users.length} compte${data.users.length > 1 ? 's' : ''}`;
      }

      usersTbody.innerHTML = data.users.map(u => `
        <tr>
          <td><strong>${escapeHTML(u.name)}</strong></td>
          <td>${escapeHTML(u.email)}</td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-danger' : 'badge-neutral'}">${u.role === 'admin' ? 'Administrateur' : 'Facturation'}</span></td>
          <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr-FR') : '-'}</td>
          <td>
            ${u.email === (currentUser && currentUser.email) ? '<span class="text-muted"><small>Votre compte</small></span>' : `<button class="btn btn-ghost btn-sm text-danger" onclick="deleteUserAccount('${u.id}', '${escapeHTML(u.name)}')">Supprimer</button>`}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      usersTbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">${escapeHTML(err.message)}</td></tr>`;
    }
  }

  window.deleteUserAccount = async function(userId, userName) {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le compte de ${userName} ?`)) return;
    try {
      const res = await fetch(apiUrl('/api/users/' + encodeURIComponent(userId)), { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        loadUsersList();
      } else {
        alert('Erreur : ' + (data.message || 'Impossible de supprimer cet utilisateur.'));
      }
    } catch (err) {
      alert('Erreur réseau : ' + err.message);
    }
  };

  if (formCreateUser) {
    formCreateUser.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('new-user-name').value.trim();
      const email = document.getElementById('new-user-email').value.trim();
      const password = document.getElementById('new-user-password').value;
      const role = document.getElementById('new-user-role').value;
      const btnSubmit = document.getElementById('btn-submit-create-user');

      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Création...';
      if (userCreateStatus) userCreateStatus.style.display = 'none';

      try {
        const res = await fetch(apiUrl('/api/users'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, role })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          formCreateUser.reset();
          if (userCreateStatus) {
            userCreateStatus.className = 'alert alert-success';
            userCreateStatus.textContent = `✓ Compte créé avec succès pour ${name} (${role === 'admin' ? 'Admin' : 'Facturation'})`;
            userCreateStatus.style.display = 'block';
          }
          loadUsersList();
        } else {
          if (userCreateStatus) {
            userCreateStatus.className = 'alert alert-danger';
            userCreateStatus.textContent = data.message || 'Échec de la création du compte.';
            userCreateStatus.style.display = 'block';
          }
        }
      } catch (err) {
        if (userCreateStatus) {
          userCreateStatus.className = 'alert alert-danger';
          userCreateStatus.textContent = `Erreur réseau : ${err.message}`;
          userCreateStatus.style.display = 'block';
        }
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = "Créer l'accès";
      }
    });
  }

  // --- MODIFICATION DU MOT DE PASSE PERSONNEL ---

  if (formChangePassword) {
    formChangePassword.addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldPassword = document.getElementById('pwd-old').value;
      const newPassword = document.getElementById('pwd-new').value;
      const btnSubmit = document.getElementById('btn-submit-pwd');

      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Modification...';
      if (pwdChangeStatus) pwdChangeStatus.style.display = 'none';

      try {
        const res = await fetch(apiUrl('/api/auth/change-password'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPassword, newPassword })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (pwdChangeStatus) {
            pwdChangeStatus.className = 'alert alert-success';
            pwdChangeStatus.textContent = '✓ Mot de passe modifié avec succès !';
            pwdChangeStatus.style.display = 'block';
          }
          formChangePassword.reset();
          setTimeout(() => {
            if (modalAccount) closeModal(modalAccount);
          }, 1500);
        } else {
          if (pwdChangeStatus) {
            pwdChangeStatus.className = 'alert alert-danger';
            pwdChangeStatus.textContent = data.message || 'Erreur lors du changement de mot de passe.';
            pwdChangeStatus.style.display = 'block';
          }
        }
      } catch (err) {
        if (pwdChangeStatus) {
          pwdChangeStatus.className = 'alert alert-danger';
          pwdChangeStatus.textContent = `Erreur réseau : ${err.message}`;
          pwdChangeStatus.style.display = 'block';
        }
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Mettre à jour mon mot de passe';
      }
    });
  }

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

  async function loadArchives() {
    const archivesTbody = document.getElementById('archives-tbody');
    archivesTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Chargement...</td></tr>';
    try {
      const res = await fetch(apiUrl('/api/archives'));
      if (!res.ok) throw new Error('Impossible de charger les archives');
      const { archives } = await res.json();
      if (!archives.length) {
        archivesTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Aucune version archivée pour le moment.</td></tr>';
        return;
      }
      archivesTbody.innerHTML = archives.map(archive => `
        <tr>
          <td>${new Date(archive.archivedAt).toLocaleString('fr-FR')}</td>
          <td>${escapeHTML(archive.source)}</td>
          <td>${Number.isInteger(archive.importedRows) ? archive.importedRows : '-'}</td>
          <td>${archive.totalDestinations}</td>
          <td style="white-space: nowrap;">
            <a class="btn btn-ghost btn-sm" href="${apiUrl('/api/archives/' + encodeURIComponent(archive.filename))}" download title="Télécharger cette archive">Télécharger</a>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      archivesTbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">${escapeHTML(err.message)}</td></tr>`;
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
    if (selectedFileContent === null) return;
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
      const rawText = await res.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (jsonErr) {
        throw new Error(`Le serveur a renvoyé une réponse invalide (${res.status} ${res.statusText})`);
      }

      if (res.ok && data.success) {
        showUploadStatus(`Succès : ${data.details.countCreated} créés, ${data.details.countUpdated} mis à jour. Total actif : ${data.details.total}`, 'success');
        loadKPIs();
        loadPrices(searchInput.value);
        loadArchives();
        setTimeout(() => { closeModal(modalUpload); }, 1800);
      } else {
        const details = Array.isArray(data.details) ? data.details.join(' ') : '';
        const alertStatus = data.alertSent
          ? ' Alerte e-mail envoyée au collaborateur.'
          : data.alertError
            ? ` Alerte e-mail non envoyée : ${data.alertError}`
            : '';
        showUploadStatus(`Erreur : ${data.message}${details ? ` ${details}` : ''}${alertStatus}`, 'danger');
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
      kpiDecreases.textContent = data.totalDecreases || 0;
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
            <td>${formatMccMnc(r.mcc, r.mnc)}</td>
            <td class="mono"><strong>${r.currentPrice.toFixed(5)} €</strong></td>
            <td class="mono text-muted">${r.previousPrice ? r.previousPrice.toFixed(5) + ' €' : '-'}</td>
            <td>${badgeHtml}</td>
            <td>${r.validFrom || '-'}</td>
            <td style="white-space: nowrap;">
              <div style="display: flex; align-items: center; gap: 8px;">
                ${generateSparklineSVG(r.history, r.currentPrice, r.priceChange, r.id)}
                <button class="btn btn-ghost btn-sm" onclick="showHistory('${r.id}')" title="Ouvrir le graphique Python et l'historique de ce tarif">
                  Graphique Python
                </button>
              </div>
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
      chartSubtitle.textContent = `Indicatif ${data.cc || '-'} | Tarif actuel en vigueur : ${parseFloat(data.currentPrice || 0).toFixed(5)} € HT / SMS`;

      // 1. Tableau détaillé d'historique
      historyTbody.innerHTML = (data.history || []).map(h => {
        const oldP = h.oldPrice !== undefined ? `${parseFloat(h.oldPrice).toFixed(5)} €` : '-';
        const newP = `${parseFloat(h.price || 0).toFixed(5)} €`;
        const diff = h.oldPrice !== undefined ? (parseFloat(h.price || 0) - parseFloat(h.oldPrice || 0)) : 0;
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

      const history = data.history || [];
      chartPointsCount.textContent = `${history.length} point${history.length === 1 ? '' : 's'}`;
      chartPointsCount.className = history.length > 1 ? 'badge badge-success' : 'badge badge-neutral';
      chartLegendInfo.textContent = 'Génération du graphique Python...';
      operatorPriceChart.onerror = () => {
        chartLegendInfo.textContent = 'Graphique indisponible : vérifiez Python 3 et les dépendances de requirements.txt.';
      };
      operatorPriceChart.onload = () => {
        chartLegendInfo.textContent = `Évolution du tarif sur ${history.length} version${history.length === 1 ? '' : 's'} historisée${history.length === 1 ? '' : 's'}.`;
      };

      openModal(modalChart);
      operatorPriceChart.src = apiUrl(`/api/history-chart?id=${encodeURIComponent(recordId)}`);

    } catch (err) {
      alert(`Erreur historique : ${err.message}`);
    }
  };

  /**
   * Trace la courbe d'évolution précise pour cet opérateur en fonction des fichiers de mise à jour.
   */
  function drawOperatorHistoryChart(canvas, history, currentPrice) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width || 760;
    const height = canvas.height || 250;

    ctx.clearRect(0, 0, width, height);

    const pointsCountEl = document.getElementById('chart-points-count');
    const legendInfoEl = document.getElementById('chart-legend-info');

    // Ordonner chronologiquement les points avec valeurs numériques garanties
    const rawPoints = (history && Array.isArray(history) && history.length > 0)
      ? history.map(h => ({
          date: h.date || 'Initial',
          price: parseFloat(h.price) || parseFloat(currentPrice) || 0.05,
          oldPrice: parseFloat(h.oldPrice) || parseFloat(h.price) || 0.05,
          source: h.source || 'Catalogue base'
        })).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      : [{
          date: 'Initial',
          price: parseFloat(currentPrice) || 0.05,
          oldPrice: parseFloat(currentPrice) || 0.05,
          source: 'Catalogue base'
        }];

    const points = rawPoints.length > 0 ? rawPoints : [{
      date: 'Initial',
      price: parseFloat(currentPrice) || 0.05,
      oldPrice: parseFloat(currentPrice) || 0.05,
      source: 'Catalogue base'
    }];

    if (pointsCountEl) {
      pointsCountEl.textContent = `${points.length} point${points.length > 1 ? 's' : ''} d'évolution`;
      pointsCountEl.className = points.length > 1 ? 'badge badge-success' : 'badge badge-neutral';
    }

    // Marges
    const padLeft = 80;
    const padRight = 50;
    const padTop = 45;
    const padBottom = 65;
    const plotW = Math.max(100, width - padLeft - padRight);
    const plotH = Math.max(100, height - padTop - padBottom);

    // Déterminer l'échelle de prix Min et Max
    const prices = points.map(p => p.price);
    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);

    if (minPrice === maxPrice) {
      minPrice = Math.max(0, minPrice * 0.85);
      maxPrice = maxPrice * 1.15 || 0.05;
    } else {
      const margin = (maxPrice - minPrice) * 0.25;
      minPrice = Math.max(0, minPrice - margin);
      maxPrice = maxPrice + margin;
    }

    // Éviter division par 0
    if (maxPrice <= minPrice) {
      maxPrice = minPrice + 0.01;
    }

    // 1. Grille horizontale de fond
    const gridLines = 4;
    ctx.strokeStyle = '#EEF2F6';
    ctx.lineWidth = 1;
    ctx.font = '11px monospace';
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'right';

    for (let i = 0; i <= gridLines; i++) {
      const y = padTop + (plotH / gridLines) * i;
      const val = maxPrice - ((maxPrice - minPrice) / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(`${val.toFixed(4)} €`, padLeft - 10, y + 4);
    }

    // 2. Coordonnées des points
    const coords = points.map((p, idx) => {
      const x = points.length === 1
        ? padLeft + plotW / 2
        : padLeft + (plotW / (points.length - 1)) * idx;
      const y = padTop + plotH - ((p.price - minPrice) / (maxPrice - minPrice)) * plotH;
      return { x, y, point: p };
    });

    // 3. Dégradé et courbe
    if (coords.length >= 2) {
      const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      grad.addColorStop(0, 'rgba(226, 0, 26, 0.20)');
      grad.addColorStop(1, 'rgba(226, 0, 26, 0.01)');

      ctx.beginPath();
      ctx.moveTo(coords[0].x, padTop + plotH);
      coords.forEach(c => ctx.lineTo(c.x, c.y));
      ctx.lineTo(coords[coords.length - 1].x, padTop + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Tracé de la ligne rouge SFR
      ctx.beginPath();
      ctx.moveTo(coords[0].x, coords[0].y);
      for (let i = 1; i < coords.length; i++) {
        ctx.lineTo(coords[i].x, coords[i].y);
      }
      ctx.strokeStyle = '#E2001A';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      // Un seul point : tracer une ligne directrice en pointillés
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(226, 0, 26, 0.35)';
      ctx.moveTo(padLeft, coords[0].y);
      ctx.lineTo(width - padRight, coords[0].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 4. Tracé des nœuds et étiquettes
    coords.forEach((c, idx) => {
      const p = c.point;

      // Halo blanc extérieur
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#E2001A';
      ctx.stroke();

      // Point central rouge
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#E2001A';
      ctx.fill();

      // Étiquette de prix
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#0F172A';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.price.toFixed(5)} €`, c.x, c.y - 10);

      // Variation (+% ou -%) par rapport au point précédent
      if (idx > 0 && points[idx - 1]) {
        const prevP = points[idx - 1].price;
        if (prevP > 0 && p.price !== prevP) {
          const diffPct = (((p.price - prevP) / prevP) * 100).toFixed(1);
          ctx.font = 'bold 10px -apple-system, sans-serif';
          if (p.price > prevP) {
            ctx.fillStyle = '#DC2626';
            ctx.fillText(`▲ +${diffPct}%`, c.x, c.y - 23);
          } else {
            ctx.fillStyle = '#059669';
            ctx.fillText(`▼ ${diffPct}%`, c.x, c.y - 23);
          }
        }
      }

      // Date d'effet
      ctx.font = '600 11px -apple-system, sans-serif';
      ctx.fillStyle = '#1E293B';
      ctx.textAlign = 'center';
      ctx.fillText(p.date || `Mise à jour ${idx + 1}`, c.x, padTop + plotH + 20);

      // Nom du fichier source Sinch
      const cleanSource = (p.source || 'base_tarifs.csv')
        .replace(/^sinch_mail_\d+_/, '')
        .slice(0, 24);
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillStyle = '#64748B';
      ctx.fillText(`📄 ${cleanSource}`, c.x, padTop + plotH + 35);
    });

    if (legendInfoEl) {
      if (points.length === 1) {
        legendInfoEl.innerHTML = `Tarif initial du catalogue de base (<strong>${points[0].source || 'base_tarifs.csv'}</strong>). Chaque nouveau fichier Sinch reçu ajoutera automatiquement son point d'évolution sur cette courbe.`;
      } else {
        legendInfoEl.innerHTML = `Courbe d'évolution tracée sur <strong>${points.length} fichiers Sinch successifs</strong>. Chaque point correspond à une date d'effet et à un fichier précis.`;
      }
    }
  }

  // Réinitialisation de la plateforme au catalogue officiel de base (0 hausse)
  const btnResetBase = document.getElementById('btn-reset-base');
  if (btnResetBase) {
    btnResetBase.addEventListener('click', async () => {
      const confirmed = confirm(
        "⚠️ AVERTISSEMENT : Risque d'écrasement des données !\n\n" +
        "Cette action va effacer les fichiers de test importés et restaurer la plateforme au catalogue officiel Sinch initial (913 destinations d'origine, 0 hausse).\n\n" +
        "Voulez-vous vraiment continuer et réinitialiser la plateforme ?"
      );
      if (!confirmed) return;

      btnResetBase.disabled = true;
      btnResetBase.textContent = 'Réinitialisation en cours...';

      try {
        const res = await fetch(apiUrl('/api/reset-base'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: '2026' })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          closeModal(modalArchives);
          loadKPIs();
          loadPrices();
          loadArchives();
          alert('✓ Réinitialisation réussie ! La plateforme est revenue au catalogue de base officiel (913 destinations, 0 hausse).');
        } else {
          alert('Erreur lors de la réinitialisation : ' + (data.message || 'Échec'));
        }
      } catch (err) {
        alert('Erreur réseau : ' + err.message);
      } finally {
        btnResetBase.disabled = false;
        btnResetBase.textContent = '⚠️ ↺ Réinitialiser au catalogue de base (Remise à 0)';
      }
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

  function formatMccMnc(mcc, mnc) {
    const fullText = `${mcc || '-'}/${mnc || '-'}`;
    if (!mnc || mnc.length <= 16) {
      return `<span class="badge-code" title="${escapeHTML(fullText)}">${escapeHTML(fullText)}</span>`;
    }

    const mncList = mnc.split(/[,;\s]+/).filter(Boolean);
    if (mncList.length > 2) {
      const preview = mncList.slice(0, 2).join(', ');
      const remainingCount = mncList.length - 2;
      return `<span class="badge-code" title="${escapeHTML(fullText)}" style="cursor: help;">${escapeHTML(mcc || '-')}/${escapeHTML(preview)} <small style="color: #6C757D; font-weight: normal;">(+${remainingCount})</small></span>`;
    }

    return `<span class="badge-code" title="${escapeHTML(fullText)}" style="max-width: 140px; display: inline-block; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;">${escapeHTML(fullText)}</span>`;
  }

  /**
   * Génère un mini-graphique sparkline vectoriel (SVG) directement dans la ligne du tableau.
   * Affiche la tendance visuelle (hausse en rouge, baisse en vert, stable en gris).
   */
  function generateSparklineSVG(history, currentPrice, priceChange, recordId) {
    const rawPoints = (history && Array.isArray(history) && history.length > 0)
      ? history.map(h => parseFloat(h.price) || parseFloat(currentPrice) || 0)
      : [parseFloat(currentPrice) || 0];

    const displayPoints = rawPoints.length === 1 ? [rawPoints[0], rawPoints[0]] : rawPoints;

    const w = 90;
    const h = 26;
    const padX = 4;
    const padY = 5;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;

    const min = Math.min(...displayPoints);
    const max = Math.max(...displayPoints);
    const range = max === min ? (max * 0.1 || 1) : (max - min);

    const coords = displayPoints.map((val, idx) => {
      const x = padX + (plotW / (displayPoints.length - 1)) * idx;
      const y = padY + plotH - ((val - min) / range) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const isUp = priceChange > 0;
    const isDown = priceChange < 0;
    const color = isUp ? '#DC2626' : (isDown ? '#059669' : '#94A3B8');
    const pointsStr = coords.join(' ');
    const lastCoord = coords[coords.length - 1].split(',');

    const tip = `${rawPoints.length} point(s) : ${rawPoints.map(p => p.toFixed(4) + '€').join(' → ')} (Cliquer pour voir la courbe détaillée)`;

    return `
      <svg width="${w}" height="${h}" class="sparkline" onclick="showHistory('${recordId}')" title="${escapeHTML(tip)}" style="vertical-align: middle; cursor: pointer; background: #FAFBFD; border-radius: 4px; border: 1px solid #EEF2F6; padding: 1px;">
        <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${pointsStr}" />
        <circle cx="${lastCoord[0]}" cy="${lastCoord[1]}" r="3" fill="${color}" />
      </svg>
    `;
  }
});
