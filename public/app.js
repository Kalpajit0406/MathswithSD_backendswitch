// State management
let resourceChart = null;
const maxDataPoints = 30;
let currentActivePort = null;
let currentChartTab = 'cpu';
let currentMainTab = 'infra';
let isLogAutoRefreshActive = true;
let logsInterval = null;

// Initialize combined Resource history chart
function initResourceChart() {
  const ctx = document.getElementById('resourceChart').getContext('2d');
  
  // CPU Gradient
  const cpuGradient = ctx.createLinearGradient(0, 0, 0, 180);
  cpuGradient.addColorStop(0, 'rgba(0, 102, 255, 0.35)');
  cpuGradient.addColorStop(1, 'rgba(0, 102, 255, 0.01)');

  // RAM Gradient
  const ramGradient = ctx.createLinearGradient(0, 0, 0, 180);
  ramGradient.addColorStop(0, 'rgba(168, 85, 247, 0.35)'); // Purple
  ramGradient.addColorStop(1, 'rgba(168, 85, 247, 0.01)');

  resourceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(maxDataPoints).fill(''),
      datasets: [
        {
          label: 'CPU Usage (%)',
          data: Array(maxDataPoints).fill(0),
          borderColor: '#0066ff',
          borderWidth: 2,
          backgroundColor: cpuGradient,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          hidden: false
        },
        {
          label: 'RAM Usage (%)',
          data: Array(maxDataPoints).fill(0),
          borderColor: '#a855f7',
          borderWidth: 2,
          backgroundColor: ramGradient,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          hidden: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(255, 255, 255, 0.03)' },
          ticks: { color: '#8e9aab', font: { size: 9 } }
        },
        x: {
          grid: { display: false },
          ticks: { display: false }
        }
      }
    }
  });
}

// Push status metrics to the charts
function updateChartData(cpuVal, ramVal) {
  if (!resourceChart) return;

  const cpuDataset = resourceChart.data.datasets[0].data;
  const ramDataset = resourceChart.data.datasets[1].data;

  cpuDataset.push(cpuVal);
  ramDataset.push(ramVal);

  if (cpuDataset.length > maxDataPoints) {
    cpuDataset.shift();
    ramDataset.shift();
  }

  resourceChart.update('none');
}

// Chart toggle handler
function showChartTab(tabName) {
  currentChartTab = tabName;
  const toggleCpu = document.getElementById('toggle-chart-cpu');
  const toggleRam = document.getElementById('toggle-chart-ram');

  if (tabName === 'cpu') {
    toggleCpu.classList.add('active');
    toggleRam.classList.remove('active');
    resourceChart.data.datasets[0].hidden = false;
    resourceChart.data.datasets[1].hidden = true;
  } else {
    toggleCpu.classList.remove('active');
    toggleRam.classList.add('active');
    resourceChart.data.datasets[0].hidden = true;
    resourceChart.data.datasets[1].hidden = false;
  }
  resourceChart.update();
}

// Main navigation tab handler
function switchMainTab(tabName) {
  currentMainTab = tabName;
  const btnInfra = document.getElementById('tab-btn-infra');
  const btnLogs = document.getElementById('tab-btn-logs');
  const paneInfra = document.getElementById('tab-content-infra');
  const paneLogs = document.getElementById('tab-content-logs');

  if (tabName === 'infra') {
    btnInfra.classList.add('active');
    btnLogs.classList.remove('active');
    paneInfra.classList.add('active');
    paneLogs.classList.remove('active');
    
    // Clear log polling interval
    if (logsInterval) {
      clearInterval(logsInterval);
      logsInterval = null;
    }
  } else {
    btnInfra.classList.remove('active');
    btnLogs.classList.add('active');
    paneInfra.classList.remove('active');
    paneLogs.classList.add('active');
    
    // Initial fetch of logs
    loadProcessLogs();
    // Start logs interval every 4 seconds
    logsInterval = setInterval(loadProcessLogs, 4000);
  }
}

// Format Helper: Bytes to human-readable
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Format Helper: Seconds to readable Uptime
function formatUptime(seconds) {
  if (!seconds || isNaN(seconds)) return 'Offline';
  
  // If uptime is milliseconds from PM2 (timestamp in epoch)
  if (seconds > 1000000000000) {
    seconds = Math.floor((Date.now() - seconds) / 1000);
  }

  const d = Math.floor(seconds / (3600*24));
  const h = Math.floor(seconds % (3600*24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  
  const dDisplay = d > 0 ? d + "d " : "";
  const hDisplay = h > 0 ? h + "h " : "";
  const mDisplay = m > 0 ? m + "m " : "";
  const sDisplay = s > 0 ? s + "s" : "0s";
  
  return dDisplay + hDisplay + mDisplay + sDisplay;
}

// Fetch main status payload
async function refreshDashboard() {
  try {
    const res = await fetch('/api/status');
    if (res.status === 401) {
      window.location.reload();
      return;
    }
    const data = await res.json();

    // Host Info
    document.getElementById('sys-hostname').textContent = data.hostname;
    document.getElementById('sys-public-ip').textContent = data.publicIp;
    document.getElementById('sys-uptime').textContent = formatUptime(data.system.uptime);
    document.getElementById('sys-node-version').textContent = data.nodeVersion;

    // Upstream Banner
    currentActivePort = data.activePort;
    const activePortDisplay = document.getElementById('active-port-display');
    activePortDisplay.textContent = data.activePort === 'split' ? 'BOTH (SPLIT)' : (data.activePort ? data.activePort : 'UNROUTED');

    const btn5000 = document.getElementById('btn-route-5000');
    const btn5001 = document.getElementById('btn-route-5001');
    const btnSplit = document.getElementById('btn-route-split');

    if (data.activePort === 5000) {
      btn5000.className = 'btn btn-secondary';
      btn5000.disabled = true;
      btn5001.className = 'btn btn-primary';
      btn5001.disabled = false;
      btnSplit.className = 'btn btn-primary';
      btnSplit.disabled = false;
    } else if (data.activePort === 5001) {
      btn5000.className = 'btn btn-primary';
      btn5000.disabled = false;
      btn5001.className = 'btn btn-secondary';
      btn5001.disabled = true;
      btnSplit.className = 'btn btn-primary';
      btnSplit.disabled = false;
    } else if (data.activePort === 'split') {
      btn5000.className = 'btn btn-primary';
      btn5000.disabled = false;
      btn5001.className = 'btn btn-primary';
      btn5001.disabled = false;
      btnSplit.className = 'btn btn-secondary';
      btnSplit.disabled = true;
    } else {
      btn5000.className = 'btn btn-primary';
      btn5000.disabled = false;
      btn5001.className = 'btn btn-primary';
      btn5001.disabled = false;
      btnSplit.className = 'btn btn-primary';
      btnSplit.disabled = false;
    }

    // API Probes
    updateProbeData(5000, data.health[5000]);
    updateProbeData(5001, data.health[5001]);

    // Resource bar values
    const ramPercent = data.system.ram.percent;
    document.getElementById('sys-ram-label').textContent = `${ramPercent}% (${formatBytes(data.system.ram.used, 1)} / ${formatBytes(data.system.ram.total, 1)})`;
    document.getElementById('sys-ram-bar').style.width = `${ramPercent}%`;

    const diskPercent = data.system.disk.percent;
    document.getElementById('sys-disk-label').textContent = `${diskPercent}% (${formatBytes(data.system.disk.used, 1)} / ${formatBytes(data.system.disk.total, 1)})`;
    document.getElementById('sys-disk-bar').style.width = `${diskPercent}%`;

    // Resource metrics numbers
    document.getElementById('sys-load-avg').textContent = data.system.loadAvg.map(n => n.toFixed(2)).join(' / ');
    document.getElementById('sys-net-rx').textContent = `${data.system.network.rxSpeed} KB/s`;
    document.getElementById('sys-net-tx').textContent = `${data.system.network.txSpeed} KB/s`;

    // Realtime metrics graph push
    updateChartData(data.system.cpu, ramPercent);

    // PM2 processes
    renderPm2Processes(data.pm2);

  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }
}

// Render health probe statistics
function updateProbeData(port, probe) {
  const badge = document.getElementById(`health-${port}-badge`);
  const statusEl = document.getElementById(`health-${port}-status`);
  const latencyEl = document.getElementById(`health-${port}-latency`);
  const card = document.getElementById(`health-${port}-card`);

  if (probe.online) {
    badge.className = 'status-indicator online';
    badge.querySelector('.text').textContent = 'ONLINE';
    statusEl.textContent = probe.status;
    latencyEl.textContent = `${probe.responseTime} ms`;
    card.classList.add('online');
  } else {
    badge.className = 'status-indicator offline';
    badge.querySelector('.text').textContent = 'OFFLINE';
    statusEl.textContent = 'Down';
    latencyEl.textContent = '-- ms';
    card.classList.remove('online');
  }
}

// Render dynamic PM2 processes cards
function renderPm2Processes(processes) {
  const container = document.getElementById('pm2-process-list-container');
  container.innerHTML = '';

  processes.forEach(proc => {
    const isOnline = proc.pm2_env.status === 'online';
    const statusClass = isOnline ? 'online' : 'offline';
    
    const div = document.createElement('div');
    div.className = 'pm2-item';
    
    const cpuStr = isOnline ? `${proc.monit.cpu}%` : '0%';
    const memStr = isOnline ? formatBytes(proc.monit.memory) : '0 MB';
    const uptimeStr = isOnline ? formatUptime(proc.pm2_env.pm_uptime) : 'Offline';

    div.innerHTML = `
      <div class="pm2-item-header">
        <div class="pm2-name-col">
          <h4>${proc.name}</h4>
          <span class="pm2-pid">PID: ${proc.pid}</span>
        </div>
        <span class="status-indicator ${statusClass}">
          <span class="dot"></span>${proc.pm2_env.status}
        </span>
      </div>
      
      <div class="pm2-metrics-row">
        <div class="pm2-metric-box">
          <span>Uptime</span>
          <strong>${uptimeStr}</strong>
        </div>
        <div class="pm2-metric-box">
          <span>CPU</span>
          <strong>${cpuStr}</strong>
        </div>
        <div class="pm2-metric-box">
          <span>Memory</span>
          <strong>${memStr}</strong>
        </div>
        <div class="pm2-metric-box">
          <span>Restarts</span>
          <strong>${proc.pm2_env.restart_time}</strong>
        </div>
      </div>
      
      <div class="pm2-actions-row">
        <button class="btn btn-secondary" onclick="confirmProcessAction('start', '${proc.name}')" ${isOnline ? 'disabled' : ''}>
          <i class="fa-solid fa-play"></i> Start
        </button>
        <button class="btn btn-danger" onclick="confirmProcessAction('stop', '${proc.name}')" ${!isOnline ? 'disabled' : ''}>
          <i class="fa-solid fa-stop"></i> Stop
        </button>
        <button class="btn btn-warning" onclick="confirmProcessAction('restart', '${proc.name}')" ${!isOnline ? 'disabled' : ''}>
          <i class="fa-solid fa-arrow-rotate-left"></i> Restart
        </button>
      </div>
    `;
    container.appendChild(div);
  });
}

// Fetch process logs
async function loadProcessLogs() {
  const select = document.getElementById('log-process-select');
  const processName = select.value;
  const terminal = document.getElementById('process-log-terminal');
  
  document.getElementById('terminal-process-title').textContent = `Process: ${processName} (100 lines)`;

  try {
    const res = await fetch(`/api/process-logs?processName=${encodeURIComponent(processName)}`);
    if (res.ok) {
      const data = await res.json();
      terminal.innerHTML = '';
      
      if (data.logs.length === 0) {
        terminal.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding-top: 2rem;">No logs found.</div>`;
        return;
      }
      
      data.logs.forEach(line => {
        const div = document.createElement('div');
        
        let lineClass = 'log-line';
        if (line.includes('SUCCESS') || line.includes('Connected') || line.includes('Ready')) {
          lineClass += ' success-log';
        } else if (line.includes('FAILED') || line.includes('Error') || line.includes('error')) {
          lineClass += ' error-log';
        }
        
        div.className = lineClass;
        div.textContent = line;
        terminal.appendChild(div);
      });
      
      // Auto Scroll to bottom
      terminal.scrollTop = terminal.scrollHeight;
    }
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

// Modal handling
function showModal(title, message, onConfirm) {
  const modalOverlay = document.getElementById('confirm-modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').textContent = message;
  
  // Reset errors
  const errorBox = document.getElementById('modal-error');
  errorBox.style.display = 'none';
  errorBox.textContent = '';
  
  // Assign confirm action
  const confirmBtn = document.getElementById('modal-confirm-btn');
  confirmBtn.onclick = onConfirm;
  confirmBtn.disabled = false;
  confirmBtn.innerHTML = 'Confirm';

  modalOverlay.classList.add('active');
}

function closeModal() {
  document.getElementById('confirm-modal').classList.remove('active');
}

// Modal confirmation: Route switching
function confirmRoute(port) {
  let name = '';
  if (port === 5000) name = 'App Backend (5000)';
  else if (port === 5001) name = 'Website Backend (5001)';
  else if (port === 'split') name = 'Both Backends (Split Routing: /api -> 5000, / -> 5001)';
  
  showModal(
    'Confirm Upstream Router Switch',
    `Are you sure you want to route public Nginx traffic (api.mathswithsd.in) to ${name}? This will validate the configuration and reload Nginx. Both backends will remain online.`,
    async () => {
      const confirmBtn = document.getElementById('modal-confirm-btn');
      const errorBox = document.getElementById('modal-error');
      
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Routing...';
      errorBox.style.display = 'none';

      try {
        const res = await fetch('/api/backend/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port })
        });
        const data = await res.json();
        
        if (data.success) {
          closeModal();
          refreshDashboard();
        } else {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = 'Confirm';
          errorBox.style.display = 'block';
          errorBox.textContent = `Nginx Routing Error: ${data.error || 'Request failed'}\n\nDetails:\n${data.details || 'No logs details available'}`;
        }
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'Confirm';
        errorBox.style.display = 'block';
        errorBox.textContent = `Connection error: ${err.message}`;
      }
    }
  );
}

// Modal confirmation: Process operations (start, stop, restart)
function confirmProcessAction(action, processName) {
  showModal(
    `Confirm Process Control: ${action} ${processName}`,
    `Are you sure you want to execute a '${action}' command on PM2 process '${processName}'? This will directly alter its active status in the runtime environment.`,
    async () => {
      const confirmBtn = document.getElementById('modal-confirm-btn');
      const errorBox = document.getElementById('modal-error');
      
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Executing...';
      errorBox.style.display = 'none';

      try {
        const res = await fetch('/api/backend/process-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, processName })
        });
        const data = await res.json();
        
        if (data.success) {
          closeModal();
          refreshDashboard();
          
          if (action === 'restart' && (processName === 'backend-switch' || processName === 'dashboard')) {
            setTimeout(() => {
              window.location.reload();
            }, 2000);
          }
        } else {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = 'Confirm';
          errorBox.style.display = 'block';
          errorBox.textContent = `PM2 Error: ${data.error || 'Execution failed'}\n\nDetails:\n${data.details || 'No error logs details'}`;
        }
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'Confirm';
        errorBox.style.display = 'block';
        errorBox.textContent = `Connection error: ${err.message}`;
      }
    }
  );
}

// Modal confirmation: Dashboard update script
function confirmUpdate() {
  showModal(
    'Confirm Dashboard Core Update',
    `Are you sure you want to pull the latest dashboard commits ('git pull origin main') and reinstall packages? The dashboard service will restart itself immediately after completion.`,
    async () => {
      const confirmBtn = document.getElementById('modal-confirm-btn');
      const errorBox = document.getElementById('modal-error');
      
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';
      errorBox.style.display = 'none';

      try {
        const res = await fetch('/api/dashboard/update', {
          method: 'POST'
        });
        const data = await res.json();
        
        if (data.success) {
          closeModal();
          alert('Update script running in background. Reloading page in 5s.');
          setTimeout(() => {
            window.location.reload();
          }, 5000);
        } else {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = 'Confirm';
          errorBox.style.display = 'block';
          errorBox.textContent = `Update Error: ${data.error || 'Failed to update'}`;
        }
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'Confirm';
        errorBox.style.display = 'block';
        errorBox.textContent = `Connection error: ${err.message}`;
      }
    }
  );
}

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
  initResourceChart();
  refreshDashboard();
  
  // Set up polling intervals
  setInterval(refreshDashboard, 5000); // Poll status endpoint every 5 seconds
});
