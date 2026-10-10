// ============ КОНФИГ ============
const CONFIG = {
  pingUrl: 'https://httpbin.org/delay/0',
  downloadUrl: 'https://httpbin.org/stream-bytes/',
  uploadUrl: 'https://httpbin.org/post',
  downloadSizeMB: 10,        // ← уменьшили: httpbin не тянет 100 МБ
  uploadSizeMB: 2,           // ← уменьшили: httpbin ограничивает POST
  pingRounds: 8,
  maxGaugeMbps: 200,
  minTestDuration: 1500,
  uiUpdateInterval: 60
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

// ============ ПЛАВНАЯ АНИМАЦИЯ ЦИФРЫ ============
let displayedValue = 0;   // что показывает спидометр СЕЙЧАС
let targetValue = 0;      // куда он должен стремиться
let animationFrame = null;

function animateGauge() {
  const diff = targetValue - displayedValue;
  if (Math.abs(diff) < 0.05) {
    displayedValue = targetValue;
    applyGauge(displayedValue);
    animationFrame = null;
    return;
  }
  // плавное «догоняние» — 15% за кадр
  displayedValue += diff * 0.15;
  applyGauge(displayedValue);
  animationFrame = requestAnimationFrame(animateGauge);
}

function setGauge(mbps) {
  targetValue = mbps;
  if (!animationFrame) {
    animationFrame = requestAnimationFrame(animateGauge);
  }
}

function applyGauge(mbps) {
  const percent = Math.min(mbps / CONFIG.maxGaugeMbps, 1);
  const offset = GAUGE_LENGTH * (1 - percent);
  gaugeFill.style.strokeDashoffset = offset;
  gaugeNumber.textContent = mbps.toFixed(1);

  const angle = -90 + percent * 180;
  needle.style.transform = `translateX(-50%) rotate(${angle}deg)`;

  let color = '#ef4444';
  if (mbps >= 100) color = '#22c55e';
  else if (mbps >= 50) color = '#84cc16';
  else if (mbps >= 20) color = '#eab308';
  else if (mbps >= 10) color = '#f97316';

  gaugeFill.style.stroke = color;
  gaugeNumber.style.color = color;
  needle.style.background = `linear-gradient(to top, ${color}, transparent)`;
}

// ============ УТИЛИТЫ ============
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
  displayedValue = 0;
  targetValue = 0;
  applyGauge(0);
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

  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const jitter = times.reduce((sum, t) => sum + Math.abs(t - median), 0) / times.length;
  const loss = ((CONFIG.pingRounds - times.length) / CONFIG.pingRounds * 100).toFixed(0);

  pingValue.textContent = median.toFixed(0);
  jitterValue.textContent = `±${jitter.toFixed(1)} мс · ${loss}% потерь`;

  highlightCard('cardPing', false);
  return { ping: median, jitter, loss: parseInt(loss) };
}

// ============ DOWNLOAD (РАЗБИТ НА ЧАСТИ) ============
async function measureDownload() {
  setStatus('⬇️ Тестируем скачивание...');
  highlightCard('cardDownload', true);

  const totalMB = CONFIG.downloadSizeMB;
  const partsCount = 5;                        // 5 частей по 20 МБ = 100 МБ
  const partMB = totalMB / partsCount;
  const partBytes = partMB * 1024 * 1024;
  const partUrl = CONFIG.downloadUrl + partBytes;

  let totalReceived = 0;
  const t0 = performance.now();
  let lastUpdate = t0;

  for (let part = 0; part < partsCount; part++) {
    // уникальный URL для каждой части → никакого кэша
    const url = `${partUrl}&r=${Math.random()}-${Date.now()}-${part}`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });

    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalReceived += value.length;

      const now = performance.now();
      if (now - lastUpdate >= CONFIG.uiUpdateInterval) {
        const elapsed = (now - t0) / 1000;
        const mbps = (totalReceived * 8) / (elapsed * 1_000_000);
        setGauge(mbps);
        downloadValue.textContent = mbps.toFixed(1);
        lastUpdate = now;
      }
    }
  }

  // финальная цифра — стабильная скорость за весь тест
  const elapsed = (performance.now() - t0) / 1000;
  const mbps = (totalReceived * 8) / (elapsed * 1_000_000);
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
  setGauge(mbps);
  uploadValue.textContent = mbps.toFixed(1);
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

  const testStartTime = performance.now();

  try {
    await fetch(CONFIG.pingUrl).catch(() => {});

    const { ping, jitter, loss } = await measurePing();
    const download = await measureDownload();
    const upload = await measureUpload();

    // гарантируем минимальное время анимации, чтобы тест не «мигнул»
    const elapsed = performance.now() - testStartTime;
    if (elapsed < CONFIG.minTestDuration) {
      await new Promise(r => setTimeout(r, CONFIG.minTestDuration - elapsed));
    }

    setStatus(
      `✅ Готово! Ping ${ping.toFixed(0)} мс · ↓ ${download.toFixed(1)} · ↑ ${upload.toFixed(1)} Мбит/с`,
      '#22c55e'
    );

    saveHistory({ time: Date.now(), ping, jitter, loss, download, upload });
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
applyGauge(0);
