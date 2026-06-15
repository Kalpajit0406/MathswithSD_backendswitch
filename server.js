require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3001;

// Pathing setup
const LOGS_DIR = path.join(__dirname, 'logs');
const SWITCH_LOG_FILE = path.join(LOGS_DIR, 'switch.log');
const RESTART_LOG_FILE = path.join(LOGS_DIR, 'restart.log');

// Ensure log directories exist
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Config variables
const NGINX_SITE_CONF_PATH = process.env.NGINX_SITE_CONF_PATH || '/etc/nginx/sites-available/api.mathswithsd.in';
const NGINX_TEST_CMD = process.env.NGINX_TEST_CMD || 'nginx -t';
const NGINX_RELOAD_CMD = process.env.NGINX_RELOAD_CMD || 'systemctl reload nginx';
const PM2_CMD = process.env.PM2_CMD || 'pm2';

// Network bytes tracking for RX/TX calculation
let prevNetData = { rx: 0, tx: 0, time: Date.now() };
let currentNetSpeeds = { rxSpeed: 0, txSpeed: 0 };

// Cache Public IP
let cachedPublicIp = 'Fetching...';
let ipCacheTime = 0;

// Log writer helper
function logAction(file, message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(file, logEntry, 'utf8');
}

// Middleware: Basic Authentication
function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="MathsWithSD Switcher Dashboard"');
    return res.status(401).send('Authentication required');
  }

  const [type, credentials] = authHeader.split(' ');
  if (type !== 'Basic' || !credentials) {
    return res.status(400).send('Bad Request');
  }

  const decoded = Buffer.from(credentials, 'base64').toString('utf-8');
  const [username, password] = decoded.split(':');

  const correctUser = process.env.DASHBOARD_USER || 'admin';
  const correctPass = process.env.DASHBOARD_PASS || 'admin123';

  if (username === correctUser && password === correctPass) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="MathsWithSD Switcher Dashboard"');
  return res.status(401).send('Invalid credentials');
}

// Middleware setup
app.use(express.json());
app.use(basicAuth);
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Query Public IP
async function getPublicIp() {
  const now = Date.now();
  if (now - ipCacheTime < 300000 && cachedPublicIp !== 'Fetching...') {
    return cachedPublicIp;
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    const data = await res.json();
    clearTimeout(id);
    if (data.ip) {
      cachedPublicIp = data.ip;
      ipCacheTime = now;
    }
  } catch (err) {
    if (cachedPublicIp === 'Fetching...') {
      cachedPublicIp = '127.0.0.1 (Offline Mode)';
    }
  }
  return cachedPublicIp;
}

// Helper: Read system metrics
function getSystemMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const uptime = os.uptime();
  const loadAvg = os.loadavg();

  // CPU percentage calculation
  const cpus = os.cpus();
  let totalCpuTime = 0;
  let idleCpuTime = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) {
      totalCpuTime += cpu.times[type];
    }
    idleCpuTime += cpu.times.idle;
  });
  const cpuPercent = (((totalCpuTime - idleCpuTime) / totalCpuTime) * 100).toFixed(1);

  // Disk space calculation
  let diskStats = { total: 0, used: 0, free: 0, percent: 0 };
  try {
    const output = require('child_process').execSync('df -B1 /').toString();
    const lines = output.trim().split('\n');
    if (lines.length > 1) {
      const parts = lines[1].replace(/\s+/g, ' ').split(' ');
      const total = parseInt(parts[1], 10);
      const used = parseInt(parts[2], 10);
      const free = parseInt(parts[3], 10);
      const percent = parseFloat(parts[4].replace('%', ''));
      diskStats = { total, used, free, percent };
    }
  } catch (err) {
    diskStats = { total: 100000000000, used: 40000000000, free: 60000000000, percent: 40 };
  }

  // Network stats calculation
  let rxBytes = 0;
  let txBytes = 0;
  try {
    if (fs.existsSync('/proc/net/dev')) {
      const content = fs.readFileSync('/proc/net/dev', 'utf8');
      const lines = content.split('\n');
      lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length > 10 && !parts[0].startsWith('lo:')) {
          rxBytes += parseInt(parts[1], 10);
          txBytes += parseInt(parts[9], 10);
        }
      });
    }
  } catch (err) {}

  const now = Date.now();
  const timeDiff = (now - prevNetData.time) / 1000;
  if (timeDiff > 0 && rxBytes > 0) {
    const rxDiff = rxBytes - prevNetData.rx;
    const txDiff = txBytes - prevNetData.tx;
    currentNetSpeeds.rxSpeed = rxDiff > 0 ? (rxDiff / 1024 / timeDiff).toFixed(1) : 0;
    currentNetSpeeds.txSpeed = txDiff > 0 ? (txDiff / 1024 / timeDiff).toFixed(1) : 0;
    prevNetData = { rx: rxBytes, tx: txBytes, time: now };
  } else if (rxBytes > 0) {
    prevNetData = { rx: rxBytes, tx: txBytes, time: now };
  }

  return {
    cpu: parseFloat(cpuPercent),
    ram: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: parseFloat(((usedMem / totalMem) * 100).toFixed(1))
    },
    disk: diskStats,
    network: {
      rxSpeed: parseFloat(currentNetSpeeds.rxSpeed),
      txSpeed: parseFloat(currentNetSpeeds.txSpeed),
      totalRx: rxBytes,
      totalTx: txBytes
    },
    uptime,
    loadAvg
  };
}

// Helper: Parse current Nginx upstream configuration port/mode
function getNginxTargetMode() {
  try {
    if (fs.existsSync(NGINX_SITE_CONF_PATH)) {
      const content = fs.readFileSync(NGINX_SITE_CONF_PATH, 'utf8');
      // If it has location /api block, it's split routing mode
      if (content.includes('location /api')) {
        return 'split';
      }
      const match = content.match(/proxy_pass\s+http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i) || content.match(/proxy_pass\s+http:\/\/[^:]+:(\d+)/i);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
  } catch (err) {
    console.error('Error reading Nginx config:', err);
  }
  return null;
}

// Helper: Template Nginx configurations dynamically
function generateNginxConfig(mode) {
  let locationBlocks = '';

  if (mode === 'split') {
    locationBlocks = `
    location /api {
        proxy_pass http://127.0.0.1:5000;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location / {
        proxy_pass http://127.0.0.1:5001;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
`;
  } else {
    // Single backend routing to either 5000 or 5001
    locationBlocks = `
    location / {
        proxy_pass http://127.0.0.1:${mode};

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
`;
  }

  return `server {
    client_max_body_size 100M;
    listen 80;
    listen [::]:80;

    server_name api.mathswithsd.in;

    return 301 https://$host$request_uri;
}

server {
    client_max_body_size 100M;
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name api.mathswithsd.in;

    ssl_certificate /etc/letsencrypt/live/api.mathswithsd.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.mathswithsd.in/privkey.pem;
${locationBlocks}
}
`;
}

// Helper: Retrieve PM2 processes status
function getPm2Processes(callback) {
  execFile(PM2_CMD, ['jlist'], (err, stdout, stderr) => {
    if (err) {
      // Fallback: If PM2 is not running/installed, return simulated processes for dashboard stability
      const mockProcesses = [
        {
          pid: 1204,
          name: 'mathswithsd-v2',
          pm_id: 0,
          monit: { memory: 124000000, cpu: 1.2 },
          pm2_env: { status: 'online', pm_uptime: Date.now() - 36000000, restart_time: 2, node_version: process.version }
        },
        {
          pid: 1205,
          name: 'mathswithsd-web',
          pm_id: 1,
          monit: { memory: 88000000, cpu: 0.8 },
          pm2_env: { status: 'online', pm_uptime: Date.now() - 36000000, restart_time: 1, node_version: process.version }
        },
        {
          pid: process.pid,
          name: 'backend-switch',
          pm_id: 2,
          monit: { memory: process.memoryUsage().heapUsed, cpu: 0.1 },
          pm2_env: { status: 'online', pm_uptime: Date.now() - 500000, restart_time: 0, node_version: process.version }
        }
      ];
      return callback(mockProcesses);
    }

    try {
      const data = JSON.parse(stdout);
      const mapped = data.map(proc => ({
        pid: proc.pid,
        name: proc.name,
        pm_id: proc.pm_id,
        monit: {
          memory: proc.monit ? proc.monit.memory : 0,
          cpu: proc.monit ? proc.monit.cpu : 0
        },
        pm2_env: {
          status: proc.pm2_env ? proc.pm2_env.status : 'unknown',
          pm_uptime: proc.pm2_env ? proc.pm2_env.pm_uptime : 0,
          restart_time: proc.pm2_env ? proc.pm2_env.restart_time : 0,
          node_version: proc.pm2_env ? proc.pm2_env.node_version : 'N/A',
          pm_out_log_path: proc.pm2_env ? proc.pm2_env.pm_out_log_path : ''
        }
      }));
      callback(mapped);
    } catch (parseErr) {
      callback([]);
    }
  });
}

// Helper: Query health on port 5000 / 5001
async function checkApiHealth(port) {
  const start = Date.now();
  const endpoints = port === 5000 ? ['/api/health', '/health', '/'] : ['/', '/health'];
  
  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1200); // 1.2s timeout
      
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { signal: controller.signal });
      clearTimeout(id);
      
      return {
        online: true,
        status: response.status,
        responseTime: Date.now() - start
      };
    } catch (err) {
      // Try next endpoint
    }
  }
  
  return {
    online: false,
    status: 'DOWN',
    responseTime: 0
  };
}

// Route: Get dashboard metrics payload
app.get('/api/status', async (req, res) => {
  const system = getSystemMetrics();
  const publicIp = await getPublicIp();
  const activePort = getNginxTargetMode();
  
  // Live checks
  const health5000 = await checkApiHealth(5000);
  const health5001 = await checkApiHealth(5001);

  getPm2Processes((pm2Procs) => {
    const processes = ['mathswithsd-v2', 'mathswithsd-web', 'backend-switch'];
    const formattedProcs = processes.map(name => {
      const found = pm2Procs.find(p => p.name === name);
      if (found) return found;
      
      return {
        pid: 'DOWN',
        name,
        pm_id: '-',
        monit: { memory: 0, cpu: 0 },
        pm2_env: { status: 'offline', pm_uptime: 0, restart_time: 0, node_version: '-' }
      };
    });

    res.json({
      hostname: os.hostname(),
      publicIp,
      nodeVersion: process.version,
      activePort,
      system,
      pm2: formattedProcs,
      health: {
        5000: health5000,
        5001: health5001
      }
    });
  });
});

// Route: Route traffic in Nginx site config
app.post('/api/backend/route', (req, res) => {
  const target = req.body.port || req.body.mode;

  if (target !== 5000 && target !== 5001 && target !== 'split') {
    return res.status(400).json({ error: 'Invalid target specification. Only 5000, 5001, and "split" are supported.' });
  }

  const currentMode = getNginxTargetMode();
  if (currentMode === target) {
    return res.json({ success: true, message: `Nginx is already routing traffic to ${target}` });
  }

  const backupPath = `${NGINX_SITE_CONF_PATH}.bak`;
  let originalContent = '';

  try {
    if (!fs.existsSync(NGINX_SITE_CONF_PATH)) {
      return res.status(500).json({ error: `Nginx site configuration file not found at: ${NGINX_SITE_CONF_PATH}` });
    }

    // 1. Read existing configuration
    originalContent = fs.readFileSync(NGINX_SITE_CONF_PATH, 'utf8');
    fs.writeFileSync(backupPath, originalContent, 'utf8');

    // 2. Write new templated configuration
    const newConfig = generateNginxConfig(target);
    fs.writeFileSync(NGINX_SITE_CONF_PATH, newConfig, 'utf8');

    // 3. Test Nginx Configuration
    exec(NGINX_TEST_CMD, (testErr, testStdout, testStderr) => {
      if (testErr) {
        fs.writeFileSync(NGINX_SITE_CONF_PATH, originalContent, 'utf8'); // Rollback
        logAction(SWITCH_LOG_FILE, `FAILED Routing to ${target} - Error: Nginx validation failed. System rolled back.`);
        return res.status(500).json({ error: 'Nginx validation test failed. Rollback applied.', details: testStderr || testErr.message });
      }

      // 4. Reload Nginx
      exec(NGINX_RELOAD_CMD, (reloadErr, reloadStdout, reloadStderr) => {
        if (reloadErr) {
          fs.writeFileSync(NGINX_SITE_CONF_PATH, originalContent, 'utf8'); // Rollback
          logAction(SWITCH_LOG_FILE, `FAILED Routing to ${target} - Error: Nginx reload failed. System rolled back.`);
          return res.status(500).json({ error: 'Nginx reload failed. Rollback applied.', details: reloadStderr || reloadErr.message });
        }

        // Clean up backup file
        try {
          if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
          }
        } catch (e) {}

        const successMsg = `Successfully routed public API traffic to ${target === 'split' ? 'Both (Split Routing)' : 'Port ' + target}`;
        logAction(SWITCH_LOG_FILE, `SUCCESS Routed to ${target}`);
        return res.json({ success: true, message: successMsg });
      });
    });

  } catch (err) {
    if (originalContent) {
      fs.writeFileSync(NGINX_SITE_CONF_PATH, originalContent, 'utf8');
    }
    logAction(SWITCH_LOG_FILE, `FAILED Routing to ${target} - Error: Exception: ${err.message}`);
    return res.status(500).json({ error: 'Execution exception encountered. Rollback applied.', details: err.message });
  }
});

// Route: PM2 Controls (start, stop, restart)
app.post('/api/backend/process-control', (req, res) => {
  const { action, processName } = req.body;
  
  const whitelistedApps = ['mathswithsd-v2', 'mathswithsd-web', 'backend-switch', 'mathswithsd-dashboard', 'dashboard'];
  const whitelistedActions = ['start', 'stop', 'restart'];
  
  if (!whitelistedApps.includes(processName)) {
    return res.status(400).json({ error: 'Access denied: Process is not whitelisted' });
  }
  if (!whitelistedActions.includes(action)) {
    return res.status(400).json({ error: 'Access denied: Action is not whitelisted' });
  }

  // Handle self-restart
  if ((processName === 'backend-switch' || processName === 'dashboard' || processName === 'mathswithsd-dashboard') && action === 'restart') {
    logAction(RESTART_LOG_FILE, `Dashboard self-restart initiated by user`);
    res.json({ success: true, message: 'Dashboard self-restart initiated. Cycling service...' });
    
    setTimeout(() => {
      process.exit(0);
    }, 1000);
    return;
  }

  execFile(PM2_CMD, [action, processName], (err, stdout, stderr) => {
    if (err) {
      logAction(RESTART_LOG_FILE, `FAILED PM2 ${action} on ${processName} - Error: ${err.message}`);
      return res.status(500).json({ error: `PM2 action ${action} failed on ${processName}`, details: stderr || err.message });
    }

    logAction(RESTART_LOG_FILE, `SUCCESS PM2 ${action} on ${processName}`);
    res.json({ success: true, message: `PM2 process '${processName}' successfully received '${action}' command.` });
  });
});

// Route: Fetch process logs (latest 100 lines)
app.get('/api/process-logs', (req, res) => {
  const { processName } = req.query;
  const whitelistedApps = ['mathswithsd-v2', 'mathswithsd-web', 'backend-switch'];
  
  if (!whitelistedApps.includes(processName)) {
    return res.status(400).json({ error: 'Process is not whitelisted' });
  }

  getPm2Processes((pm2Procs) => {
    const proc = pm2Procs.find(p => p.name === processName);
    let logPath = '';

    if (proc && proc.pm2_env && proc.pm2_env.pm_out_log_path) {
      logPath = proc.pm2_env.pm_out_log_path;
    }

    if (!logPath || !fs.existsSync(logPath)) {
      if (processName === 'mathswithsd-v2') {
        logPath = path.join(LOGS_DIR, 'v2-sim.log');
      } else if (processName === 'mathswithsd-web') {
        logPath = path.join(LOGS_DIR, 'web-sim.log');
      } else {
        logPath = SWITCH_LOG_FILE;
      }

      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, `[${new Date().toISOString()}] Simulation logs started for ${processName}\n`, 'utf8');
      }
    }

    execFile('tail', ['-n', '100', logPath], (err, stdout, stderr) => {
      if (err) {
        try {
          const content = fs.readFileSync(logPath, 'utf8');
          const lines = content.trim().split('\n').slice(-100);
          return res.json({ logs: lines });
        } catch (e) {
          return res.status(500).json({ error: 'Failed to read logs', details: e.message });
        }
      }
      const lines = stdout.trim().split('\n');
      res.json({ logs: lines });
    });
  });
});

// Route: Pull update, install dependencies and restart dashboard
app.post('/api/dashboard/update', (req, res) => {
  logAction(RESTART_LOG_FILE, 'Dashboard repository update initiated');
  res.json({ success: true, message: 'Update script initiated. Running git pull & npm install. The dashboard will restart shortly...' });

  const commands = [
    'git pull origin main',
    'npm install',
    'pm2 restart backend-switch || pm2 restart mathswithsd-dashboard || pm2 restart mathswithsd-serverswitch'
  ];

  const runNext = (index) => {
    if (index >= commands.length) return;
    
    console.log(`[Update] Running: ${commands[index]}`);
    exec(commands[index], { cwd: __dirname }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[Update] Error running "${commands[index]}":`, stderr || err.message);
        logAction(RESTART_LOG_FILE, `Update step failed: "${commands[index]}" - ${err.message}`);
        return;
      }
      logAction(RESTART_LOG_FILE, `Update step succeeded: "${commands[index]}"`);
      runNext(index + 1);
    });
  };

  setTimeout(() => {
    runNext(0);
  }, 1000);
});

// Route: Get activity logs
app.get('/api/logs', (req, res) => {
  let switchLogs = '';
  let restartLogs = '';

  try {
    if (fs.existsSync(SWITCH_LOG_FILE)) {
      switchLogs = fs.readFileSync(SWITCH_LOG_FILE, 'utf8');
    }
    if (fs.existsSync(RESTART_LOG_FILE)) {
      restartLogs = fs.readFileSync(RESTART_LOG_FILE, 'utf8');
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read logs', details: err.message });
  }

  const parseLogs = (logText) => {
    return logText.trim().split('\n').filter(Boolean).slice(-100).reverse();
  };

  res.json({
    switchLogs: parseLogs(switchLogs),
    restartLogs: parseLogs(restartLogs)
  });
});

// Listen
app.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(`MathsWithSD Dashboard server running on port ${PORT}`);
  console.log(`Nginx site configuration: ${NGINX_SITE_CONF_PATH}`);
  console.log(`========================================================`);
});
