// Global state variables
let cpuChart = null;
const maxDataPoints = 30;
let currentActivePort = null;
let activeLogTab = 'switch';
let cachedLogs = { switchLogs: [], restartLogs: [] };

// Initialize Chart.js
function initCpuChart() {
  const ctx = document.getElementById('cpuChart').getContext('2d');
  
  // Create gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, 150);
  gradient.addColorStop(0, 'rgba(0, 105, 255, 0.4)');
  gradient.addColorStop(1, 'rgba(0, 105, 255, 0.01)');

  cpuChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(maxDataPoints).fill(''),
      datasets: [{
        label: 'CPU Usage (%)',
        data: Array(maxDataPoints).fill(0),
        borderColor: '#0069ff',
        borderWidth: 2,
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
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
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { color: '#94a3b8', font: { size: 9 } }
        },
        x: {
          grid: { display: false },
          ticks: { display: false }
        }
      }
    }
  });
}

// Format Helper: Bytes to human-readable format
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
  const d = Math.floor(seconds / (3600*24));
  const h = Math.floor(seconds % (3600*24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  
  const dDisplay = d > 0 ? d + (d === 1 ? " day, " : " days, ") : "";
  const hDisplay = h > 0 ? h + (h === 1 ? " hr, " : " hrs, ") : "";
  const mDisplay = m > 0 ? m + (m === 1 ? " min, " : " mins, ") : "";
  const sDisplay = s > 0 ? s + " sec" : "0 sec";
  
  return dDisplay + hDisplay + mDisplay + sDisplay;
}

// Push CPU usage to the realtime chart
function updateCpuChart(newValue) {
  if (!cpuChart) return;
  
  const dataset = cpuChart.data.datasets[0].data;
  dataset.push(newValue);
  if (dataset.length > maxDataPoints) {
    dataset.shift();
  }
  
  cpuChart.update('none'); // Update without full animation for performance
}

// Retrieve status payload
async function refreshDashboard() {
  try {
    const res = await fetch('/api/status');
    if (res.status === 401) {
      window.location.reload(); // Trigger re-auth prompt
      return;
    }
    const data = await res.json();
    
    // Update global state
    currentActivePort = data.activePort;

    // Update metadata
    document.getElementById('sys-hostname').textContent = data.hostname;
    document.getElementById('sys-public-ip').textContent = data.publicIp;
    document.getElementById('sys-node-version').textContent = data.nodeVersion;
    document.getElementById('sys-uptime').textContent = formatUptime(data.system.uptime);
    
    // Update active port banners & buttons
    const activePortDisplay = document.getElementById('active-port-display');
    activePortDisplay.textContent = data.activePort ? data.activePort : 'UNKNOWN';
    
    const btn5000 = document.getElementById('btn-switch-5000');
    const btn5001 = document.getElementById('btn-switch-5001');

    if (data.activePort === 5000) {
      btn5000.className = 'btn btn-secondary';
      btn5000.disabled = true;
      btn5001.className = 'btn btn-primary';
      btn5001.disabled = false;
    } else if (data.activePort === 5001) {
      btn5000.className = 'btn btn-primary';
      btn5000.disabled = false;
      btn5001.className = 'btn btn-secondary';
      btn5001.disabled = true;
    } else {
      btn5000.className = 'btn btn-primary';
      btn5000.disabled = false;
      btn5001.className = 'btn btn-primary';
      btn5001.disabled = false;
    }

    // Update health statistics
    document.getElementById('cpu-percent').textContent = `${data.system.cpu}%`;
    updateCpuChart(data.system.cpu);

    // RAM stats
    const ramPercent = data.system.ram.percent;
    document.getElementById('ram-percent').textContent = `${ramPercent}%`;
    document.getElementById('ram-used').textContent = formatBytes(data.system.ram.used);
    document.getElementById('ram-total').textContent = formatBytes(data.system.ram.total);
    document.getElementById('ram-bar').style.width = `${ramPercent}%`;

    // Disk stats
    const diskPercent = data.system.disk.percent;
    document.getElementById('disk-percent').textContent = `${diskPercent}%`;
    document.getElementById('disk-used').textContent = formatBytes(data.system.disk.used);
    document.getElementById('disk-total').textContent = formatBytes(data.system.disk.total);
    document.getElementById('disk-bar').style.width = `${diskPercent}%`;

    // Network throughput speed
    document.getElementById('net-rx').textContent = `${data.system.network.rxSpeed} KB/s`;
    document.getElementById('net-tx').textContent = `${data.system.network.txSpeed} KB/s`;

    // Load average
    const loadStr = data.system.loadAvg.map(val => val.toFixed(2)).join(' / ');
    document.getElementById('sys-load').textContent = loadStr;

    // PM2 processes
    renderPm2Rows(data.pm2);

  } catch (err) {
    console.error('Error fetching dashboard status:', err);
  }
}

// Render processes list
function renderPm2Rows(processes) {
  const container = document.getElementById('pm2-process-rows');
  container.innerHTML = '';

  if (processes.length === 0) {
    container.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No managed PM2 processes running.</td></tr>`;
    return;
  }

  processes.forEach(proc => {
    const row = document.createElement('tr');
    
    // Status color badge
    let statusClass = 'unknown';
    if (proc.pm2_env.status === 'online') statusClass = 'online';
    else if (['stopped', 'errored', 'stopping'].includes(proc.pm2_env.status)) statusClass = 'stopped';
    
    const cpuVal = proc.monit.cpu ? `${proc.monit.cpu}%` : '0%';
    const memVal = proc.monit.memory ? formatBytes(proc.monit.memory) : '0 MB';

    row.innerHTML = `
      <td style="font-family: var(--font-family-mono); font-size: 0.8rem;">${proc.pm_id}</td>
      <td style="font-weight: 600;">${proc.name}</td>
      <td>
        <span class="status-badge ${statusClass}">
          <span class="dot"></span>${proc.pm2_env.status}
        </span>
      </td>
      <td>${proc.pm2_env.restart_time}</td>
      <td style="font-family: var(--font-family-mono);">${memVal}</td>
      <td style="font-family: var(--font-family-mono);">${cpuVal}</td>
      <td>
        <button class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;" onclick="confirmRestart('${proc.name}')">
          <i class="fa-solid fa-arrow-rotate-left"></i> Restart
        </button>
      </td>
    `;
    container.appendChild(row);
  });
}

// Fetch Logs
async function refreshLogs() {
  try {
    const res = await fetch('/api/logs');
    if (res.ok) {
      cachedLogs = await res.json();
      renderActiveLogs();
    }
  } catch (err) {
    console.error('Error fetching system logs:', err);
  }
}

// Render active logs in terminal
function renderActiveLogs() {
  const terminal = document.getElementById('log-terminal');
  const activeLogs = activeLogTab === 'switch' ? cachedLogs.switchLogs : cachedLogs.restartLogs;
  
  terminal.innerHTML = '';
  
  if (activeLogs.length === 0) {
    terminal.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding-top: 2rem;">No logged events yet.</div>';
    return;
  }

  activeLogs.forEach(line => {
    const logLineDiv = document.createElement('div');
    
    // Colorize logs depending on success/error/warning
    let lineClass = 'log-line';
    if (line.includes('SUCCESS')) lineClass += ' success-log';
    else if (line.includes('FAILED')) lineClass += ' error-log';
    
    // Split timestamp and text
    const match = line.match(/^\[(.*?)\] (.*)$/);
    if (match) {
      logLineDiv.className = lineClass;
      logLineDiv.innerHTML = `<span class="time">${new Date(match[1]).toLocaleTimeString()}</span> ${match[2]}`;
    } else {
      logLineDiv.className = 'log-line';
      logLineDiv.textContent = line;
    }
    
    terminal.appendChild(logLineDiv);
  });
}

// Tab Switching
function showLogTab(tabName) {
  activeLogTab = tabName;
  
  const toggleSwitch = document.getElementById('toggle-switch-logs');
  const toggleRestart = document.getElementById('toggle-restart-logs');
  
  if (tabName === 'switch') {
    toggleSwitch.classList.add('active');
    toggleRestart.classList.remove('active');
  } else {
    toggleSwitch.classList.remove('active');
    toggleRestart.classList.add('active');
  }
  
  renderActiveLogs();
}

// Modal handling
let currentModalAction = null;

function showModal(title, message, onConfirm) {
  const modalOverlay = document.getElementById('confirm-modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').textContent = message;
  
  // Reset error box
  const errorBox = document.getElementById('modal-error');
  errorBox.style.display = 'none';
  errorBox.textContent = '';
  
  // Set confirmation handler
  const confirmBtn = document.getElementById('modal-confirm-btn');
  confirmBtn.onclick = onConfirm;
  confirmBtn.disabled = false;
  confirmBtn.innerHTML = 'Confirm';

  modalOverlay.classList.add('active');
}

function closeModal() {
  document.getElementById('confirm-modal').classList.remove('active');
}

// Confirm switcher action
function confirmSwitch(port) {
  showModal(
    'Confirm Upstream Router Switch',
    `Are you sure you want to redirect all public web traffic to the service running on port ${port}? This will run 'nginx -t' and safely reload configuration.`,
    async () => {
      const confirmBtn = document.getElementById('modal-confirm-btn');
      const errorBox = document.getElementById('modal-error');
      
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Switching...';
      errorBox.style.display = 'none';

      try {
        const res = await fetch('/api/backend/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port })
        });
        const data = await res.json();
        
        if (data.success) {
          closeModal();
          refreshDashboard();
          refreshLogs();
        } else {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = 'Confirm';
          errorBox.style.display = 'block';
          errorBox.textContent = `Error: ${data.error || 'Switch failed'}\n\nDetails:\n${data.details || 'No error details'}`;
          refreshLogs();
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

// Confirm app restart action
function confirmRestart(processName) {
  showModal(
    `Confirm Restart: ${processName}`,
    `Are you sure you want to issue a restart command for the application process: '${processName}'? This will temporarily interrupt traffic for this service.`,
    async () => {
      const confirmBtn = document.getElementById('modal-confirm-btn');
      const errorBox = document.getElementById('modal-error');
      
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Restarting...';
      errorBox.style.display = 'none';

      try {
        const res = await fetch('/api/backend/restart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ processName })
        });
        const data = await res.json();
        
        if (data.success) {
          closeModal();
          refreshDashboard();
          refreshLogs();
          
          if (processName === 'dashboard' || processName === 'mathswithsd-dashboard') {
            // Dashboard is reloading itself; reload page after 2 seconds
            setTimeout(() => {
              window.location.reload();
            }, 2000);
          }
        } else {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = 'Confirm';
          errorBox.style.display = 'block';
          errorBox.textContent = `Error: ${data.error || 'Restart failed'}\n\nDetails:\n${data.details || 'No error details'}`;
          refreshLogs();
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

// Initial script execution
document.addEventListener('DOMContentLoaded', () => {
  initCpuChart();
  refreshDashboard();
  refreshLogs();
  
  // Set up polling timers
  setInterval(refreshDashboard, 2000); // System stats refresh every 2 seconds
  setInterval(refreshLogs, 5000);      // Logs poll every 5 seconds
});
