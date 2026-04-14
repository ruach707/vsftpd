const express = require('express');
const session = require('express-session');
const Docker = require('dockerode');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const docker = new Docker();

// Credenciais padrão (senha hash para "admin123")
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD_HASH = bcrypt.hashSync('admin123', 10);

// Environment variable for default password (can be changed on startup)
let CURRENT_PASSWORD_HASH = process.env.ADMIN_PASSWORD ? 
  bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10) : 
  ADMIN_PASSWORD_HASH;

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: false,
    maxAge: 3600000,
    httpOnly: true
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
async function execInContainer(cmd) {
  try {
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
      stream.on('end', () => resolve(output));
      stream.on('error', reject);
    });
  } catch (err) {
    throw err;
  }
}

// Login route
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USERNAME && bcrypt.compareSync(password, CURRENT_PASSWORD_HASH)) {
    req.session.authenticated = true;
    req.session.username = username;
    res.redirect('/');
  } else {
    res.render('login', { error: 'Credenciais inválidas' });
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
    // List FTP users from /etc/passwd (exclude system users)
    const passwdOutput = await execInContainer("grep '/data' /etc/passwd | cut -d: -f1 | grep -v root");
    const users = passwdOutput.trim().split('\n').filter(u => u && u !== 'root');

    const logsOutput = await execInContainer('tail -50 /var/log/vsftpd/vsftpd.log 2>/dev/null || echo "No logs yet"');
    const logs = logsOutput.trim().split('\n').filter(l => l);

    res.render('index', { users, logs, username: req.session.username });
  } catch (err) {
    res.render('index', { users: [], logs: ['Error: ' + err.message], username: req.session.username });
  }
});

app.post('/add-user', requireAuth, async (req, res) => {
  const { username, password } = req.body;
  try {
    await execInContainer(`/usr/local/bin/add-ftp-user.sh ${username} '${password}'`);
    res.redirect('/');
  } catch (err) {
    res.send('Error adding user: ' + err.message);
  }
});

app.post('/del-user', requireAuth, async (req, res) => {
  const { username, action } = req.body;
  let cmd = `/usr/local/bin/del-ftp-user.sh ${username} ${action}`;
  if (action === '--delete' && req.body.removeHome) {
    cmd += ' -r';
  }
  try {
    await execInContainer(cmd);
    res.redirect('/');
  } catch (err) {
    res.send('Error: ' + err.message);
  }
});

// Change password route
app.get('/change-password', requireAuth, (req, res) => {
  res.render('change-password', { error: null, success: null, username: req.session.username });
});

app.post('/change-password', requireAuth, (req, res) => {
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
  res.render('change-password', { 
    error: null,
    success: 'Senha alterada com sucesso! A nova senha será válida na próxima sessão.',
    username: req.session.username
  });
});

app.listen(3000, () => {
  console.log('Frontend running on http://localhost:3000');
});
