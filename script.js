// ============ КОНФИГ ============
const CONFIG = {
  pingUrl: 'https://speed.cloudflare.com/__down?bytes=0',
  downloadUrl: 'https://speed.cloudflare.com/__down?bytes=',
  uploadUrl: 'https://speed.cloudflare.com/__up',
  downloadSizeMB: 25,
  uploadSizeMB: 10,
  pingRounds: 8,
  maxGaugeMbps: 200
};

// ============ DOM ============
const startBtn = document.getElementById('startBtn');
const statusEl = document.getElementById('status');
const gaugeNumber = document.getElementById('gaugeNumber');
const gaugeFill = document.getElementById('gaugeFill');
const needle = document.getElementById('needle');
const speedometer = document.getElementById('speedometer');
const loadingRing = document.getElementById('loadingRing');
const pingValue = document.getElementById('pingValue');
const downloadValue = document.getElementById('downloadValue');
const uploadValue = document.getElementById('uploadValue');
const jitterValue = document.getElementById('jitterValue');
const historyBlock = document.getElementById('historyBlock');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistory');

const GAUGE_LENGTH = 251.2;
const HISTORY_KEY = 'speedtest_history';

// ============ УТИЛИТЫ ============
function setGauge(mbps) {
  const percent = Math.min(mbps / CONFIG.maxGaugeMbps, 1);
  const offset = GAUGE_LENGTH * (1 - percent);
  gaugeFill.style.strokeDashoffset = offset;
  gaugeNumber.textContent = mbps.toFixed(1);

  // Стрелка: от -90° до +90°
  const angle = -90 + percent * 180;
  needle.style.transform = `translateX(-50%) rotate(${angle}deg)`;

  // Цвет
  let color = '#ef4444';
  if (mbps >= 100) color = '#22c55e';
  else if (mbps >= 50) color = '#84cc16';
  else if (mbps >= 20) color = '#eab308';
  else if (mbps >= 10) color = '#f97316';

  gaugeFill.style.stroke = color;
  gaugeNumber.style.color = color;
  needle.style.background = `linear-gradient(to top, ${color}, transparent)`;
}

function setStatus(text, color = '#94a3b8') {
  statusEl.textContent = text;
  statusEl.style.color = color;
}

function highlightCard(id, on) {
  document.querySelectorAll('.result-card').forEach(c => c.classList.remove('active'));
  if (on) document.getElementById(id)?.classList.add('active');
}

function setActive(on) {
  speedometer.classList.toggle('active', on);
  loadingRing.classList.toggle('active', on);
  startBtn.classList.toggle('loading', on);
}

function resetUI() {
  pingValue.textContent = '—';
  downloadValue.textContent = '—';
  uploadValue.textContent = '—';
  jitterValue.textContent = '';
  setGauge(0);
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// ============ PING + JITTER ============
async function measurePing() {
  setStatus('📡 Измеряем задержку и стабильность...');
  highlightCard('cardPing', true);

  const times = [];
  for (let i = 0; i < CONFIG.pingRounds; i++) {
    const t0 = performance.now();
    try {
      await fetch(CONFIG.pingUrl + '&r=' + Math.random(), { cache: 'no-store' });
      times.push(performance.now() - t0);
    } catch (e) {
      console.warn('Ping error', e);
    }
  }

  if (times.length === 0) throw new Error('Не удалось измерить ping');

  // Медиана для ping
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Jitter — среднее отклонение от медианы
  const jitter = times.reduce((sum, t) => sum + Math.abs(t - median), 0) / times.length;

  // Потери пакетов
  const loss = ((CONFIG.pingRounds - times.length) / CONFIG.pingRounds * 100).toFixed(0);

  pingValue.textContent = median.toFixed(0);
  jitterValue.textContent = `±${jitter.toFixed(1)} мс · ${loss}% потерь`;

  highlightCard('cardPing', false);
  return { ping: median, jitter, loss: parseInt(loss) };
}

// ============ DOWNLOAD ============
async function measureDownload() {
  setStatus('⬇️ Тестируем скачивание...');
  highlightCard('cardDownload', true);

  const url = CONFIG.downloadUrl + (CONFIG.downloadSizeMB * 1024 * 1024) + '&r=' + Math.random();
  const t0 = performance.now();

  const response = await fetch(url, { cache: 'no-store' });
  const reader = response.body.getReader();
  let received = 0;
  let lastUpdate = t0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;

    const now = performance.now();
    if (now - lastUpdate > 100) {
      const elapsed = (now - t0) / 1000;
      const mbps = (received * 8) / (elapsed * 1_000_000);
      setGauge(mbps);
      downloadValue.textContent = mbps.toFixed(1);
      lastUpdate = now;
    }
  }

  const elapsed = (performance.now() - t0) / 1000;
  const mbps = (received * 8) / (elapsed * 1_000_000);
  setGauge(mbps);
  downloadValue.textContent = mbps.toFixed(1);
  highlightCard('cardDownload', false);
  return mbps;
}

// ============ UPLOAD ============
async function measureUpload() {
  setStatus('⬆️ Тестируем загрузку...');
  highlightCard('cardUpload', true);

  const sizeBytes = CONFIG.uploadSizeMB * 1024 * 1024;
  const data = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i += 65536) {
    crypto.getRandomValues(data.subarray(i, Math.min(i + 65536, sizeBytes)));
  }

  const t0 = performance.now();
  await fetch(CONFIG.uploadUrl, {
    method: 'POST',
    body: data,
    headers: { 'Content-Type': 'application/octet-stream' }
  });

  const elapsed = (performance.now() - t0) / 1000;
  const mbps = (sizeBytes * 8) / (elapsed * 1_000_000);
  uploadValue.textContent = mbps.toFixed(1);
  setGauge(mbps);
  highlightCard('cardUpload', false);
  return mbps;
}

// ============ ИСТОРИЯ ============
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(item) {
  const history = loadHistory();
  history.unshift(item);
  // храним последние 10
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
  renderHistory();
}

function renderHistory() {
  const history = loadHistory();
  if (history.length === 0) {
    historyBlock.style.display = 'none';
    return;
  }
  historyBlock.style.display = 'block';
  historyList.innerHTML = history.map(item => `
    <div class="history-item">
      <span class="history-time">${formatTime(item.time)}</span>
      <span class="history-speeds">
        <span>⬇ ${item.download.toFixed(1)}</span>
        <span>⬆ ${item.upload.toFixed(1)}</span>
      </span>
      <span class="history-ping">${item.ping.toFixed(0)} мс</span>
    </div>
  `).join('');
}

clearHistoryBtn.addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

// ============ ОСНОВНОЙ ТЕСТ ============
async function runTest() {
  startBtn.disabled = true;
  setActive(true);
  resetUI();

  try {
    const { ping, jitter, loss } = await measurePing();
    const download = await measureDownload();
    const upload = await measureUpload();

    setStatus(
      `✅ Готово! Ping ${ping.toFixed(0)} мс · ↓ ${download.toFixed(1)} · ↑ ${upload.toFixed(1)} Мбит/с`,
      '#22c55e'
    );

    // сохраняем в историю
    saveHistory({
      time: Date.now(),
      ping, jitter, loss, download, upload
    });
  } catch (err) {
    console.error(err);
    setStatus('❌ Ошибка: ' + err.message, '#ef4444');
  } finally {
    startBtn.disabled = false;
    setActive(false);
    highlightCard(null, false);
  }
}

// ============ ИНИЦИАЛИЗАЦИЯ ============
startBtn.addEventListener('click', runTest);
renderHistory();
setGauge(0);
