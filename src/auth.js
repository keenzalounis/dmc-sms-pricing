/**
 * DMC SMS Pricing - Module d'authentification et de gestion des utilisateurs
 *
 * Implémentation sécurisée avec zéro dépendance externe :
 * - Hachage fort des mots de passe par scrypt + sel cryptographique (module crypto natif)
 * - Jetons de session aléatoires sécurisés de 256 bits (32 octets)
 * - Gestion des rôles : 'admin' (Kenza - accès total) et 'billing' (collègues - consultation & export)
 * - Stockage protégé dans data/users.json (exclu de Git)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_PATH = path.join(__dirname, '..', 'data', 'users.json');

// Sessions actives en mémoire : token -> { userId, email, name, role, expiresAt }
const activeSessions = new Map();
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

/**
 * Hache un mot de passe en utilisant scrypt avec sel aléatoire.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Vérifie un mot de passe contre son hash stocké (résistant aux attaques de temporisation).
 */
function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

/**
 * Charge la liste des utilisateurs.
 * Si le fichier n'existe pas, crée le compte administrateur initial pour Kenza.
 */
function loadUsers() {
  if (fs.existsSync(USERS_PATH)) {
    try {
      const raw = fs.readFileSync(USERS_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.users) && data.users.length > 0) {
        return data.users;
      }
    } catch (e) {
      console.warn(`[AUTH] Erreur lecture users.json : ${e.message}`);
    }
  }

  // Initialisation du premier compte Admin
  const defaultAdmin = {
    id: 'user_admin_kenza',
    email: 'kenza.lounis@sfr.com',
    name: 'Kenza Lounis',
    role: 'admin',
    passwordHash: hashPassword('Admin@2026!'),
    createdAt: new Date().toISOString()
  };

  saveUsers([defaultAdmin]);
  console.log('[AUTH] Compte administrateur initial créé : kenza.lounis@sfr.com (Rôle: admin)');
  return [defaultAdmin];
}

/**
 * Sauvegarde la liste des utilisateurs dans data/users.json.
 */
function saveUsers(users) {
  const dir = path.dirname(USERS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = {
    updatedAt: new Date().toISOString(),
    users
  };
  const tmpPath = `${USERS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, USERS_PATH);
}

function findUserByEmail(email) {
  if (!email) return null;
  const users = loadUsers();
  const cleanEmail = email.toLowerCase().trim();
  return users.find(u => u.email.toLowerCase().trim() === cleanEmail) || null;
}

function findUserById(id) {
  if (!id) return null;
  const users = loadUsers();
  return users.find(u => u.id === id) || null;
}

/**
 * Crée un nouvel utilisateur (réservé aux admins).
 */
function createUser({ email, name, password, role = 'billing' }) {
  if (!email || !email.includes('@')) {
    throw new Error('Adresse e-mail invalide.');
  }
  if (!password || password.length < 6) {
    throw new Error('Le mot de passe doit comporter au moins 6 caractères.');
  }
  const validRoles = ['admin', 'billing'];
  if (!validRoles.includes(role)) {
    throw new Error(`Rôle invalide. Rôles acceptés : ${validRoles.join(', ')}`);
  }

  const existing = findUserByEmail(email);
  if (existing) {
    throw new Error(`Un compte avec l'adresse "${email}" existe déjà.`);
  }

  const users = loadUsers();
  const newUser = {
    id: 'user_' + crypto.randomBytes(8).toString('hex'),
    email: email.toLowerCase().trim(),
    name: (name || email.split('@')[0]).trim(),
    role,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);

  return {
    id: newUser.id,
    email: newUser.email,
    name: newUser.name,
    role: newUser.role,
    createdAt: newUser.createdAt
  };
}

/**
 * Supprime un utilisateur (interdit de supprimer le dernier administrateur).
 */
function deleteUser(id) {
  const users = loadUsers();
  const target = users.find(u => u.id === id);
  if (!target) {
    throw new Error('Utilisateur introuvable.');
  }

  if (target.role === 'admin') {
    const adminCount = users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) {
      throw new Error('Impossible de supprimer le seul compte administrateur de la plateforme.');
    }
  }

  const updated = users.filter(u => u.id !== id);
  saveUsers(updated);

  // Invalider les sessions de cet utilisateur
  for (const [token, session] of activeSessions.entries()) {
    if (session.userId === id) {
      activeSessions.delete(token);
    }
  }

  return true;
}

/**
 * Modifie le mot de passe d'un utilisateur.
 */
function updatePassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Le nouveau mot de passe doit comporter au moins 6 caractères.');
  }
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  if (!user) throw new Error('Utilisateur introuvable.');

  user.passwordHash = hashPassword(newPassword);
  user.updatedAt = new Date().toISOString();
  saveUsers(users);
  return true;
}

/**
 * Crée une session sécurisée après authentification réussie.
 */
function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    expiresAt: Date.now() + SESSION_DURATION_MS
  };
  activeSessions.set(token, session);
  return session;
}

function getSession(token) {
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  if (token) {
    activeSessions.delete(token);
  }
}

/**
 * Parse les cookies de la requête HTTP.
 */
function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;

  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

/**
 * Authentifie une requête entrante via son cookie de session ou son header Authorization.
 */
function authenticateRequest(req) {
  // 1. Essai via cookie
  const cookies = parseCookies(req);
  const token = cookies['dmc_session'];
  if (token) {
    const session = getSession(token);
    if (session) {
      return { authenticated: true, user: session };
    }
  }

  // 2. Essai via Header Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    const session = getSession(bearerToken);
    if (session) {
      return { authenticated: true, user: session };
    }
  }

  return { authenticated: false, user: null };
}

module.exports = {
  hashPassword,
  verifyPassword,
  loadUsers,
  saveUsers,
  findUserByEmail,
  findUserById,
  createUser,
  deleteUser,
  updatePassword,
  createSession,
  getSession,
  destroySession,
  parseCookies,
  authenticateRequest
};
