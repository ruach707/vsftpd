const express = require('express');
const session = require('express-session');
const Docker = require('dockerode');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const crypto = require('crypto');
const { PassThrough } = require('stream');

const app = express();
const docker = new Docker();

const ADMIN_USERNAME = 'admin';
const PASSWORD_FILE = '/app/data/admin_password.hash';

// Arquivo tem prioridade (preserva trocas feitas pelo painel).
// Se não existir: usa ADMIN_PASSWORD do env ou 'admin123', salva no arquivo.
function loadOrCreatePassword() {
  try {
    fs.mkdirSync(path.dirname(PASSWORD_FILE), { recursive: true });
  } catch (_) {}

  try {
    if (fs.existsSync(PASSWORD_FILE)) {
      const hash = fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
      if (hash) return hash;
    }
  } catch (err) {
    console.log('[WARN] Erro ao ler arquivo de senha:', err.message);
  }

  // Primeiro boot: define senha inicial a partir do env ou padrão
  const initial = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = bcrypt.hashSync(initial, 10);
  try {
    fs.writeFileSync(PASSWORD_FILE, hash, 'utf8');
    console.log('[INFO] Senha inicial salva em', PASSWORD_FILE);
  } catch (err) {
    console.log('[WARN] Não foi possível salvar senha inicial:', err.message);
  }
  return hash;
}

let CURRENT_PASSWORD_HASH = loadOrCreatePassword();

// A05 — Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:");
  next();
});

// Session configuration — A05/A07 fixes
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,   // não cria sessão para visitantes não autenticados
  cookie: {
    secure: false,            // mudar para true quando houver HTTPS/proxy reverso
    maxAge: 3600000,
    httpOnly: true,
    sameSite: 'strict'        // A01 — mitiga CSRF via cookie
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// A01 — CSRF: gera token por sessão e injeta em todas as views
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
});

function csrfProtect(req, res, next) {
  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).send('Requisição inválida (CSRF)');
  }
  next();
}

// A07 — Rate limiting de login (sem dependência externa)
const loginAttempts = new Map();
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function loginRateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress;
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + LOGIN_WINDOW_MS; }
  if (entry.count >= LOGIN_MAX) {
    return res.status(429).render('login', {
      error: 'Muitas tentativas. Aguarde 15 minutos.',
      csrfToken: res.locals.csrfToken
    });
  }
  req._loginEntry = entry;
  req._loginIp = ip;
  loginAttempts.set(ip, entry);
  next();
}

// A02 — Geração de senha criptograficamente segura (somente alfanumérico, sem caracteres especiais)
function generatePassword(length = 24) {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

// Validação de username (reutilizável)
const VALID_USERNAME = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,31}$/;
const VALID_ACTIONS  = new Set(['--disable', '--enable', '--delete']);

const CONTAINER_NAME = 'vsftpd';

// Middleware to check authentication
function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Helper to exec command in container
async function execInContainer(cmd, timeoutMs = 15000) {
  const container = docker.getContainer(CONTAINER_NAME);
  const exec = await container.exec({
    Cmd: ['sh', '-c', cmd],
    AttachStdout: true,
    AttachStderr: true
  });
  const stream = await exec.start();
  let output = '';
  stream.on('data', (chunk) => {
    output += chunk.toString();
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stream.destroy();
      resolve(output);
    }, timeoutMs);
    stream.on('end', () => { clearTimeout(timer); resolve(output); });
    stream.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

// Login route
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', loginRateLimit, csrfProtect, (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && bcrypt.compareSync(password, CURRENT_PASSWORD_HASH)) {
    loginAttempts.delete(req._loginIp);   // limpa contador em caso de sucesso
    req.session.regenerate(err => {       // A07 — previne session fixation
      if (err) return res.redirect('/login');
      req.session.authenticated = true;
      req.session.username = username;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.redirect('/');
    });
  } else {
    req._loginEntry.count++;
    res.render('login', { error: 'Credenciais inválidas', csrfToken: res.locals.csrfToken });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Dashboard route
app.get('/', requireAuth, async (req, res) => {
  try {
    // List FTP users by checking /data directory (more reliable)
    const usersOutput = await execInContainer('ls -1 /data 2>/dev/null || echo ""');
    const users = usersOutput.trim().split('\n').filter(u => u && u !== '' && u !== 'root' && u !== 'admin');

    const logsOutput = await execInContainer('tail -50 /var/log/vsftpd/vsftpd.log 2>/dev/null || echo "No logs yet"');
    const logs = logsOutput.trim().split('\n').filter(l => l);

    res.render('index', { users, logs, username: req.session.username });
  } catch (err) {
    res.render('index', { users: [], logs: ['Error: ' + err.message], username: req.session.username });
  }
});

app.post('/add-user', requireAuth, csrfProtect, async (req, res) => {
  const { username, password } = req.body;
  // A03 — validação antes de qualquer uso em shell
  if (!VALID_USERNAME.test(username)) return res.status(400).send('Usuário inválido');
  if (!password || password.length < 6) return res.status(400).send('Senha muito curta');
  if (password.includes("'")) return res.status(400).send('Senha contém caractere inválido');
  try {
    await execInContainer(`/usr/local/bin/add-ftp-user.sh ${username} '${password}'`);
    res.redirect('/');
  } catch (err) {
    console.error('[add-user]', err.message);   // A09 — log server-side
    res.status(500).send('Erro ao criar usuário');
  }
});

app.post('/del-user', requireAuth, csrfProtect, async (req, res) => {
  const { username, action } = req.body;
  // A03 — whitelist de ação + validação de usuário
  if (!VALID_USERNAME.test(username)) return res.status(400).send('Usuário inválido');
  if (!VALID_ACTIONS.has(action)) return res.status(400).send('Ação inválida');
  let cmd = `/usr/local/bin/del-ftp-user.sh ${username} ${action}`;
  if (action === '--delete' && req.body.removeHome === 'yes') cmd += ' -r';
  try {
    await execInContainer(cmd);
    res.redirect('/');
  } catch (err) {
    console.error('[del-user]', err.message);
    res.status(500).send('Erro ao processar ação');
  }
});

// Change password route
app.get('/change-password', requireAuth, (req, res) => {
  res.render('change-password', { error: null, success: null, username: req.session.username });
});

app.post('/change-password', requireAuth, csrfProtect, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  // Validate current password
  if (!bcrypt.compareSync(currentPassword, CURRENT_PASSWORD_HASH)) {
    return res.render('change-password', { 
      error: 'Senha atual incorreta',
      success: null,
      username: req.session.username
    });
  }

  // Validate new passwords match
  if (newPassword !== confirmPassword) {
    return res.render('change-password', { 
      error: 'Senhas novas não conferem',
      success: null,
      username: req.session.username
    });
  }

  // Validate password strength
  if (newPassword.length < 6) {
    return res.render('change-password', { 
      error: 'Senha deve ter no mínimo 6 caracteres',
      success: null,
      username: req.session.username
    });
  }

  // Update password
  CURRENT_PASSWORD_HASH = bcrypt.hashSync(newPassword, 10);
  
  // Salvar no arquivo para persistência
  try {
    fs.writeFileSync(PASSWORD_FILE, CURRENT_PASSWORD_HASH, 'utf8');
    console.log('Senha salva com sucesso');
  } catch (err) {
    console.log('Aviso: Não foi possível salvar a senha no arquivo:', err.message);
  }
  
  res.render('change-password', { 
    error: null,
    success: 'Senha alterada com sucesso! A nova senha será válida na próxima sessão.',
    username: req.session.username
  });
});

// Criar usuário com senha gerada automaticamente
app.post('/add-user-generate', requireAuth, async (req, res) => {
  const { username } = req.body;
  if (!VALID_USERNAME.test(username)) {
    return res.json({ success: false, error: 'Nome de usuário inválido' });
  }
  const password = generatePassword();   // A02 — crypto seguro
  try {
    await execInContainer(`/usr/local/bin/add-ftp-user.sh ${username} '${password}'`);
    res.json({ success: true, username, password });
  } catch (err) {
    console.error('[add-user-generate]', err.message);
    res.json({ success: false, error: 'Erro ao criar usuário' });
  }
});

// Download de arquivo do diretório do usuário
app.get('/download', requireAuth, async (req, res) => {
  const user = req.query.user;
  const file = req.query.file;

  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,31}$/.test(user)) {
    return res.status(400).send('Usuário inválido');
  }
  if (!file || file.includes('..') || file.includes('/') || file.includes('\0') || file.includes("'")) {
    return res.status(400).send('Arquivo inválido');
  }

  try {
    const container = docker.getContainer(CONTAINER_NAME);
    const exec = await container.exec({
      Cmd: ['cat', `/data/${user}/${file}`],
      AttachStdout: true,
      AttachStderr: true
    });
    const stream = await exec.start();

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    docker.modem.demuxStream(stream, stdout, stderr);
    stderr.resume();

    const safeFilename = file.replace(/["\\]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    stdout.pipe(res);
    stream.on('error', err => { if (!res.headersSent) res.status(500).send(err.message); });
  } catch (err) {
    if (!res.headersSent) res.status(500).send('Erro: ' + err.message);
  }
});

// Status de todos os usuários (chamado async pelo frontend)
app.get('/users-status', requireAuth, async (req, res) => {
  try {
    const output = await execInContainer(
      'for u in $(ls -1 /data/ 2>/dev/null); do ' +
      '[ -d "/data/$u" ] || continue; ' +
      'S=$(passwd -S "$u" 2>/dev/null | awk \'{print $2}\'); ' +
      'T=$(stat -c %Y /data/$u/* 2>/dev/null | sort -rn | head -1); ' +
      'echo "$u:${S:-U}:${T:-0}"; ' +
      'done'
    );
    const nowSec = Date.now() / 1000;
    const result = {};
    output.trim().split('\n').filter(Boolean).forEach(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const user = parts[0];
        const st = parts[1].trim();
        const ts = parseInt(parts[2]) || 0;
        result[user] = {
          status: st === 'L' ? 'locked' : 'active',
          lastFileDays: ts > 0 ? Math.floor((nowSec - ts) / 86400) : null
        };
      }
    });
    res.json(result);
  } catch (err) {
    res.json({});
  }
});

// Detalhes de um usuário (disk, arquivos, logs)
app.get('/user-details/:user', requireAuth, async (req, res) => {
  const user = req.params.user;
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,31}$/.test(user)) {
    return res.status(400).json({ error: 'Usuário inválido' });
  }
  try {
    const [diskOut, filesOut, statusOut, logOut] = await Promise.all([
      execInContainer(`du -sh /data/${user}/ 2>/dev/null | cut -f1`),
      execInContainer(`ls -lht /data/${user}/ 2>/dev/null | tail -n +2 | head -10`),
      execInContainer(`passwd -S ${user} 2>/dev/null || echo "? U"`),
      execInContainer(`grep -i "${user}" /var/log/vsftpd/vsftpd.log 2>/dev/null | tail -5 || echo ""`)
    ]);

    const locked = (statusOut.trim().split(' ')[1] || 'U') === 'L';

    const files = filesOut.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 9) {
        return { name: parts.slice(8).join(' '), date: `${parts[5]} ${parts[6]} ${parts[7]}`, size: parts[4] };
      }
      return null;
    }).filter(Boolean);

    res.json({
      user,
      locked,
      diskUsage: diskOut.trim() || 'N/D',
      files,
      lastLogs: logOut.trim().split('\n').filter(Boolean)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Redefinir senha — exige senha mestra antes de gerar nova senha
app.post('/reset-password', requireAuth, csrfProtect, async (req, res) => {
  const { username, masterPassword } = req.body;
  if (!VALID_USERNAME.test(username)) {
    return res.status(400).json({ error: 'Usuário inválido' });
  }
  if (!masterPassword || !bcrypt.compareSync(masterPassword, CURRENT_PASSWORD_HASH)) {
    return res.status(403).json({ success: false, error: 'Senha mestra incorreta' });
  }
  const password = generatePassword();
  try {
    await execInContainer(`/usr/local/bin/add-ftp-user.sh ${username} '${password}'`);
    res.json({ success: true, password, username });
  } catch (err) {
    console.error('[reset-password]', err.message);
    res.json({ success: false, error: 'Erro ao redefinir senha' });
  }
});

app.listen(3000, () => {
  console.log('Frontend running on http://localhost:3000');
});
