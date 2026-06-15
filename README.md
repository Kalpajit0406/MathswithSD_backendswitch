# 🎛️ MathsWithSD — Production Management Dashboard

This is a production-grade, self-contained system management dashboard designed for Ubuntu/Debian Linux environments. It runs on port `3001` and enables safe backend switching (port 5000/5001), real-time system metric visualization, PM2 process monitoring, and safe shell execution.

---

## 📋 Table of Contents
1. [Architecture & Design](#architecture--design)
2. [Prerequisites & System Setup](#prerequisites--system-setup)
3. [Installation Commands](#installation-commands)
4. [PM2 Process Management](#pm2-process-management)
5. [Nginx Configuration](#nginx-configuration)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [Backup & Recovery Strategy](#backup--recovery-strategy)
8. [Future Improvements](#future-improvements)

---

## 🏛️ Architecture & Design

The dashboard runs as a standalone Node.js service:
* **Backend**: Express.js server capturing system metrics natively from Linux subsystems (`/proc`, `df`, `os`).
* **Frontend**: HTML5 UI with a sleek dark theme styled after DigitalOcean, utilizing Chart.js for real-time CPU charting.
* **Authentication**: HTTP Basic Authentication via highly secure, non-hardcoded environment secrets.
* **Safety**: Fully whitelisted parameters on PM2 restart actions, combined with Nginx backup generation, automatic `nginx -t` validation testing, and instant rollback on syntax validation failures.

---

## ⚙️ Prerequisites & System Setup

To allow the Node.js application to safely validate and reload Nginx configurations without password prompts, add a specific permission rule to your system sudoers.

1. Open the sudoers configuration:
   ```bash
   sudo visudo -f /etc/sudoers.d/mathswithsd-dashboard
   ```
2. Paste the following rule (assuming the process runs under user `kalpajit`):
   ```sudoers
   kalpajit ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx
   ```
3. Save and close the editor.

---

## 🛠️ Installation Commands

Set up and start the dashboard by running these commands in your shell:

```bash
# Clone or navigate to the directory
cd /home/kalpajit/MathswithSD_serverswitch

# Install node dependencies
npm install

# Set up environment variables
cp .env.example .env
# Open and configure secure credentials:
# nano .env
```

---

## 🔁 PM2 Process Management

Manage the dashboard process lifecycle using these PM2 commands:

```bash
# Start the dashboard under PM2
pm2 start ecosystem.config.js

# Save PM2 process list to persist across system reboots
pm2 save

# Setup PM2 startup script to automatically boot on machine start
pm2 startup

# Monitor live logs for the dashboard
pm2 logs mathswithsd-dashboard

# Check current PM2 status list
pm2 list
```

---

## 🌐 Nginx Configuration

The reverse proxy relies on an isolated upstream configuration file. Set up your main Nginx site block to refer to this upstream block.

### 1. Upstream Configuration (`/etc/nginx/conf.d/mathswithsd-upstream.conf`)
This file is modified by the dashboard switcher. It has the following structure:
```nginx
upstream mathswithsd_backend {
    server 127.0.0.1:5000; # Switcher changes this to 5001 dynamically
}
```

### 2. Main Site block (`/etc/nginx/sites-available/mathswithsd`)
Your main server block should point to the dynamic upstream configured above:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.mathswithsd.in;

    # SSL configuration goes here (handled via Certbot)

    location / {
        proxy_pass http://mathswithsd_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Make sure to symlink to site-enabled and reload:
```bash
sudo ln -s /etc/nginx/sites-available/mathswithsd /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🆘 Troubleshooting Guide

### Issue 1: "Permission Denied when switching backends"
* **Diagnosis**: The Node.js application process cannot overwrite `/etc/nginx/conf.d/mathswithsd-upstream.conf` or run reload commands.
* **Resolution**:
  1. Verify the owner of the upstream conf file is set to `kalpajit`:
     ```bash
     sudo chown kalpajit:kalpajit /etc/nginx/conf.d/mathswithsd-upstream.conf
     ```
  2. Verify the sudoers configuration allows Nginx validation and reloads:
     ```bash
     sudo -l
     ```

### Issue 2: "Nginx Reload Failed"
* **Diagnosis**: Nginx configuration test succeeded, but reload command encountered an issue.
* **Resolution**:
  - The switcher dashboard will automatically restore the original working configuration in `mathswithsd-upstream.conf` and abort.
  - Review the dashboard terminal log block or check systemd logs:
    ```bash
    sudo journalctl -u nginx -n 50
    ```

### Issue 3: "PM2 commands fail"
* **Diagnosis**: The system runs PM2 globally under a different user or Node version path.
* **Resolution**: Set the absolute path to your PM2 executable in the `.env` file, e.g. `PM2_CMD=/usr/local/bin/pm2` or `PM2_CMD=npx pm2`.

---

## 💾 Backup & Recovery Strategy

### 1. Automated Switch Backups
Before writing any config updates, the switcher automatically creates a `.bak` backup file:
```javascript
const backupPath = `${NGINX_UPSTREAM_CONF_PATH}.bak`;
```
If anything fails during the verification step (`nginx -t` or `systemctl reload`), the dashboard immediately restores the backup file.

### 2. Manual Backup Configuration
We recommend backing up Nginx's main directory daily. Add this simple script to a daily cron task:
```bash
#!/bin/bash
tar -czf /backups/nginx-$(date +%F).tar.gz /etc/nginx
```

---

## 🚀 Future Improvements

1. **Slack/Discord Webhook Notifications**: Push alert notifications immediately to Slack or Discord whenever a backend environment switch is triggered or a service encounters an error.
2. **Cluster Mode Statistics**: Aggregate PM2 performance metrics across clustered instances for large-scale load environments.
3. **Advanced Log Streaming**: Stream live stdout/stderr files of other PM2 services directly in the dashboard UI using WebSockets.
