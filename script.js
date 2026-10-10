// ============ КОНФИГУРАЦИЯ ============
const CONFIG = {
  pingUrl: 'https://speed.cloudflare.com/__down?bytes=0',
  downloadUrl: 'https://speed.cloudflare.com/__down?bytes=',
  uploadUrl: 'https://speed.cloudflare.com/__up',
  downloadSizeMB: 25,      // сколько МБ качать
  uploadSizeMB: 10,        // сколько МБ загружать
  pingRounds: 5,           // сколько раз мерить ping
  maxGaugeMbps: 200        // максимум спидометра (для шкалы)
};

// ============ DOM ============
const startBtn = document.getElementById('startBtn');
const statusEl = document.getElementById('status');
const gaugeNumber = document.getElementById('gaugeNumber');
const gaugeFill = document.getElementById('gaugeFill');
const pingValue = document.getElementById('pingValue');
const downloadValue = document.getElementById('downloadValue');
const uploadValue = document.getElementById('uploadValue');

const GAUGE_LENGTH = 251.2; // длина дуги (для 80px радиуса)

// ============ УТИЛИТЫ ============
function setGauge(mbps) {
  const percent = Math.min(mbps / CONFIG.maxGaugeMbps, 1);
  const offset = GAUGE_LENGTH * (1 - percent);
  gaugeFill.style.strokeDashoffset = offset;
  gaugeNumber.textContent = mbps.toFixed(1);

  // цвет в зависимости от скорости
  let color = '#ef4444';       // красный < 10
  if (mbps >= 100) color = '#22c55e';   // зелёный
  else if (mbps >= 50) color = '#84cc16'; // лайм
  else if (mbps >= 20) color = '#eab308'; // жёлтый
  else if (mbps >= 10) color = '#f97316'; // оранжевый

  gaugeFill.style.stroke = color;
  gaugeNumber.style.color = color;
}

function setStatus(text, color = '#94a3b8') {
  statusEl.textContent = text;
  statusEl.style.color = color;
}

function highlightCard(id, on) {
  document.querySelectorAll('.result-card').forEach(c => c.classList.remove('active'));
  if (on) document.getElementById(id)?.closest('.result-card').classList.add('active');
}

function resetUI() {
  pingValue.textContent = '—';
  downloadValue.textContent = '—';
  uploadValue.textContent = '—';
  gaugeNumber.textContent = '0';
  gaugeFill.style.strokeDashoffset = GAUGE_LENGTH;
  setGauge(0);
}

// ============ PING ============
async function measurePing() {
  setStatus('📡 Измеряем задержку...');
  highlightCard('pingValue', true);

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

  // берём медиану — устойчиво к выбросам
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  pingValue.textContent = median.toFixed(0);
  highlightCard('pingValue', false);
  return median;
}

// ============ DOWNLOAD ============
async function measureDownload() {
  setStatus('⬇️ Тестируем скачивание...');
  highlightCard('downloadValue', true);

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
    if (now - lastUpdate > 100) { // обновляем UI каждые 100 мс
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
  highlightCard('downloadValue', false);
  return mbps;
}

// ============ UPLOAD ============
async function measureUpload() {
  setStatus('⬆️ Тестируем загрузку...');
  highlightCard('uploadValue', true);

  // создаём случайные данные, чтобы не сжались
  const sizeBytes = CONFIG.uploadSizeMB * 1024 * 1024;
  const data = new Uint8Array(sizeBytes);
  // заполняем блоками (быстрее, чем весь массив)
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
  highlightCard('uploadValue', false);
  return mbps;
}

// ============ ОСНОВНОЙ ТЕСТ ============
async function runTest() {
  startBtn.disabled = true;
  resetUI();

  try {
    const ping = await measurePing();
    const download = await measureDownload();
    const upload = await measureUpload();

    setStatus(
      `✅ Готово! Ping ${ping.toFixed(0)} мс · ↓ ${download.toFixed(1)} · ↑ ${upload.toFixed(1)} Мбит/с`,
      '#22c55e'
    );
  } catch (err) {
    console.error(err);
    setStatus('❌ Ошибка: ' + err.message, '#ef4444');
  } finally {
    startBtn.disabled = false;
    highlightCard(null, false);
  }
}

// ============ СОБЫТИЯ ============
startBtn.addEventListener('click', runTest);