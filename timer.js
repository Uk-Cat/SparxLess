// ============================================================
// timer.js — Session Timer for Sparx Maths
// ============================================================

console.log('[Sparx Timer] Loading...');

function initTimer() {
  console.log('[Sparx Timer] Initializing...');

  // Inject CSS
  const timerStyle = document.createElement('style');
  timerStyle.innerHTML = `
    #sparx-custom-timer {
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.85);
      color: #00ff00;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      font-weight: bold;
      font-family: 'Courier New', monospace;
      border: 1px solid #333;
    }
  `;
  
  if (document.head) {
    document.head.appendChild(timerStyle);
  } else {
    document.documentElement.appendChild(timerStyle);
  }

  // Create timer element
  const timer = document.createElement('div');
  timer.id = 'sparx-custom-timer';
  timer.innerText = 'Session: 0:00';
  document.body.appendChild(timer);

  console.log('[Sparx Timer] ✓ Timer initialized');

  // Start timer
  let seconds = 0;
  setInterval(() => {
    seconds++;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timer.innerText = `Session: ${minutes}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

// Try to init immediately
if (document.body && document.head) {
  initTimer();
} else {
  // Wait for DOM
  document.addEventListener('DOMContentLoaded', initTimer);
  // Fallback: try after 1 second
  setTimeout(initTimer, 1000);
}
