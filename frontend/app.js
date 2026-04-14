const express = require('express');
const Docker = require('dockerode');
const path = require('path');

const app = express();
const docker = new Docker();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

const CONTAINER_NAME = 'vsftpd';

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

// Routes
app.get('/', async (req, res) => {
  try {
    // List users (simple way: list /data directories)
    const usersOutput = await execInContainer('ls -1 /data');
    const users = usersOutput.trim().split('\n').filter(u => u);

    // Get logs (last 50 lines)
    const logsOutput = await execInContainer('tail -50 /var/log/vsftpd/vsftpd.log');
    const logs = logsOutput.trim().split('\n');

    res.render('index', { users, logs });
  } catch (err) {
    res.render('index', { users: [], logs: ['Error: ' + err.message] });
  }
});

app.post('/add-user', async (req, res) => {
  const { username, password } = req.body;
  try {
    await execInContainer(`/usr/local/bin/add-ftp-user.sh ${username} '${password}'`);
    res.redirect('/');
  } catch (err) {
    res.send('Error adding user: ' + err.message);
  }
});

app.post('/del-user', async (req, res) => {
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

app.listen(3000, () => {
  console.log('Frontend running on http://localhost:3000');
});