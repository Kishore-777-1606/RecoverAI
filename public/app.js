/**
 * RecoverAI Frontend Single Page Application Core
 * Phase 14: Tech Cursor Particle Trail & Autonomous Recovery Engine
 * Connects directly to backend Express APIs and live PostgreSQL.
 */

// Global Application State
const state = {
  merchantId: 'd9b04245-c1e1-455f-bb54-df25c3453b3f', // Default Acme Tech Solutions
  currentRoute: 'landing',
  selectedPayment: null,
  selectedRecovery: null,
  dashboardMetrics: null,
  payments: [],
  recoveries: [],
  manualReviewQueue: [],
  policy: null,
};

// ==========================================
// FORMATTING & DATA UTILITIES
// ==========================================

// Format Indian Rupee (INR) currency safely
function formatINR(amount) {
  const num = parseFloat(amount);
  if (isNaN(num)) return '₹0.00';
  return '₹' + num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Format percentages safely (prevents 8500% bug)
function formatPercent(value) {
  if (value === null || value === undefined) return '0%';
  let num = parseFloat(value);
  if (isNaN(num)) return '0%';
  if (num > 0 && num <= 1) {
    num = num * 100;
  }
  return `${num.toFixed(0)}%`;
}

// Format Strategy enum to human-readable label
function formatStrategy(strategyId) {
  if (!strategyId) return 'Recovery Link';
  switch (strategyId) {
    case 'RECOVERY_LINK': return 'Recovery Link';
    case 'DELAYED_RETRY': return 'Delayed Retry';
    case 'CUSTOMER_REMINDER': return 'Customer Reminder';
    case 'MANUAL_REVIEW': return 'Manual Review';
    case 'FRAUD_BLOCK': return 'Fraud Prevention Block';
    default: return strategyId.replace(/_/g, ' ');
  }
}

// Format Failure Code to human-readable description
function formatFailureCode(code) {
  if (!code) return 'Standard Checkout Failure';
  switch (code) {
    case 'INSUFFICIENT_FUNDS': return 'Insufficient Balance';
    case 'TEMPORARY_BANK_ISSUE': return 'Temporary Bank Network Issue';
    case 'NETWORK_ERROR': return 'Gateway Network Error';
    case 'UPI_TIMEOUT': return 'UPI Session Timeout';
    case 'CARD_DECLINED': return 'Card Issuer Declined';
    case 'FRAUD_SUSPECTED': return 'High Risk / Fraud Suspected';
    case 'SUCCESS': return 'Transaction Succeeded';
    default: return code.replace(/_/g, ' ');
  }
}

// Format Lifecycle Stage to readable label
function formatStage(stage) {
  if (!stage) return 'Initiated';
  switch (stage) {
    case 'ANALYSIS': return 'AI Analysis & Policy';
    case 'OUTREACH': return 'Customer Outreach';
    case 'VERIFICATION': return 'Settlement Verification';
    case 'COMPLETED': return 'Recovery Completed';
    case 'TERMINAL_FAIL': return 'Exhausted / Closed';
    default: return stage.replace(/_/g, ' ');
  }
}

// API Helper
async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-merchant-id': state.merchantId,
    ...(options.headers || {})
  };

  try {
    const res = await fetch(path, { ...options, headers });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('API Error:', path, err);
    return { ok: false, status: 500, error: err.message };
  }
}

// Toast Notifications Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bg = type === 'success' ? 'bg-emerald-900 border border-emerald-700 text-white' : (type === 'error' ? 'bg-rose-900 border border-rose-700 text-white' : 'bg-slate-900 border border-slate-700 text-white');
  const icon = type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-triangle' : 'info');

  toast.className = `pointer-events-auto flex items-center space-x-2.5 px-4 py-3 rounded-xl shadow-xl ${bg} text-xs font-semibold transform transition-all duration-200 translate-y-2 opacity-0`;
  toast.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4 flex-shrink-0"></i><span class="truncate">${message}</span>`;
  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// Copy link with toast feedback
function copyToClipboard(text, message = 'Recovery link copied to clipboard!') {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(message, 'success');
    }).catch(() => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
    showToast('Copied to clipboard!', 'success');
  } catch (err) {
    showToast('Failed to copy', 'error');
  }
  document.body.removeChild(textArea);
}

// =========================================================
// INTERSECTION OBSERVER SCROLL REVEAL SYSTEM
// =========================================================
function setupScrollReveal() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal-item').forEach(el => el.classList.add('revealed'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, {
    root: null,
    rootMargin: '0px 0px -60px 0px',
    threshold: 0.12
  });

  document.querySelectorAll('.reveal-item').forEach(el => observer.observe(el));
}

// =========================================================
// TECH CURSOR EFFECT & FLOATING PARTICLE TRAIL ENGINE
// =========================================================
let cursorInitialized = false;

function initTechCursor() {
  if (cursorInitialized) return;
  
  const cursorDot = document.getElementById('cursor-dot');
  const cursorRing = document.getElementById('cursor-ring');
  const canvas = document.getElementById('cursor-canvas');
  if (!cursorDot || !canvas) return;

  // Disable on touch devices or if reduced-motion requested
  if (window.matchMedia('(hover: none) or (pointer: coarse)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cursorDot.style.display = 'none';
    if (cursorRing) cursorRing.style.display = 'none';
    canvas.style.display = 'none';
    return;
  }

  cursorInitialized = true;
  const ctx = canvas.getContext('2d');
  
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }, { passive: true });

  let mouseX = width / 2;
  let mouseY = height / 2;
  let dotX = mouseX;
  let dotY = mouseY;
  let ringX = mouseX;
  let ringY = mouseY;
  let isMoving = false;
  let moveTimeout;

  // Fintech / Recovery Tech Symbols for particle trail
  const TECH_SYMBOLS = ['₹', '$', 'AI', '⚡', '🔒', '✓', '01', 'λ', '◈', '↗'];
  const particles = [];
  const MAX_PARTICLES = 36;

  class TechParticle {
    constructor(x, y) {
      this.x = x + (Math.random() - 0.5) * 16;
      this.y = y + (Math.random() - 0.5) * 16;
      this.vx = (Math.random() - 0.5) * 1.4;
      this.vy = -(Math.random() * 1.5 + 0.6); // float upward
      this.alpha = 0.9;
      this.decay = Math.random() * 0.02 + 0.015;
      this.size = Math.random() * 3 + 10;
      this.symbol = TECH_SYMBOLS[Math.floor(Math.random() * TECH_SYMBOLS.length)];
      // Choose fintech blues, emeralds, or purples
      const colors = ['rgba(37, 95, 230, ', 'rgba(16, 185, 129, ', 'rgba(147, 51, 234, '];
      this.color = colors[Math.floor(Math.random() * colors.length)];
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.alpha -= this.decay;
    }

    draw(ctx) {
      if (this.alpha <= 0) return;
      ctx.save();
      ctx.font = `600 ${this.size}px "JetBrains Mono", monospace`;
      ctx.fillStyle = `${this.color}${this.alpha})`;
      ctx.shadowColor = `${this.color}0.5)`;
      ctx.shadowBlur = 6;
      ctx.fillText(this.symbol, this.x, this.y);
      ctx.restore();
    }
  }

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    if (cursorDot.style.opacity === '0') {
      cursorDot.style.opacity = '1';
      if (cursorRing) cursorRing.style.opacity = '1';
    }

    // Spawn 1-2 particles when moving fast enough
    if (particles.length < MAX_PARTICLES && Math.random() > 0.35) {
      particles.push(new TechParticle(mouseX, mouseY));
    }

    isMoving = true;
    clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => { isMoving = false; }, 120);
  }, { passive: true });

  window.addEventListener('mouseleave', () => {
    cursorDot.style.opacity = '0';
    if (cursorRing) cursorRing.style.opacity = '0';
  });

  // Attach hover response to interactive UI elements
  function attachHoverListeners() {
    document.querySelectorAll('a, button, input, select, [role="button"], details').forEach(el => {
      if (!el.dataset.cursorBound) {
        el.dataset.cursorBound = 'true';
        el.addEventListener('mouseenter', () => {
          cursorDot.classList.add('hovered');
          if (cursorRing) cursorRing.classList.add('hovered');
        });
        el.addEventListener('mouseleave', () => {
          cursorDot.classList.remove('hovered');
          if (cursorRing) cursorRing.classList.remove('hovered');
        });
      }
    });
  }

  attachHoverListeners();
  setInterval(attachHoverListeners, 1500);

  // 60FPS RAF animation loop
  function renderLoop() {
    // 1. Lerp cursor dot and ring
    dotX += (mouseX - dotX) * 0.35;
    dotY += (mouseY - dotY) * 0.35;
    ringX += (mouseX - ringX) * 0.15;
    ringY += (mouseY - ringY) * 0.15;

    cursorDot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;
    if (cursorRing) {
      cursorRing.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
    }

    // 2. Clear & draw canvas particles
    ctx.clearRect(0, 0, width, height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.update();
      p.draw(ctx);
      if (p.alpha <= 0) {
        particles.splice(i, 1);
      }
    }

    requestAnimationFrame(renderLoop);
  }

  requestAnimationFrame(renderLoop);
}

// Hero Interactive Spotlight Controller
function setupHeroGlow() {
  const heroSection = document.getElementById('hero-section');
  const heroGlow = document.getElementById('hero-radial-glow');
  if (!heroSection || !heroGlow) return;

  let heroMouseX = 0;
  let heroMouseY = 0;
  let currentHeroGlowX = 0;
  let currentHeroGlowY = 0;
  let isInside = false;

  heroSection.addEventListener('mouseenter', () => { isInside = true; });
  heroSection.addEventListener('mouseleave', () => { isInside = false; });
  heroSection.addEventListener('mousemove', (e) => {
    const rect = heroSection.getBoundingClientRect();
    heroMouseX = e.clientX - rect.left;
    heroMouseY = e.clientY - rect.top;
  }, { passive: true });

  function animateHeroGlow() {
    if (isInside) {
      currentHeroGlowX += (heroMouseX - currentHeroGlowX) * 0.08;
      currentHeroGlowY += (heroMouseY - currentHeroGlowY) * 0.08;
      heroGlow.style.transform = `translate3d(${currentHeroGlowX - 250}px, ${currentHeroGlowY - 250}px, 0)`;
      heroGlow.style.opacity = '0.35';
    } else {
      heroGlow.style.opacity = '0.15';
    }
    requestAnimationFrame(animateHeroGlow);
  }
  requestAnimationFrame(animateHeroGlow);
}

// Initialize Router & Global Navigation
function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  
  // Merchant Selector Scope Change
  const merchantSelect = document.getElementById('merchant-selector');
  if (merchantSelect) {
    merchantSelect.value = state.merchantId;
    merchantSelect.addEventListener('change', (e) => {
      state.merchantId = e.target.value;
      showToast(`Switched Merchant: ${e.target.options[e.target.selectedIndex].text}`, 'info');
      handleRoute();
    });
  }

  // Demo Reset Button
  const resetBtn = document.getElementById('btn-demo-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to clean reset simulated demo records in PostgreSQL? Core merchant seeds will remain intact.')) return;
      const res = await api('/demo/reset', { method: 'POST' });
      if (res.ok) {
        showToast('Demo simulation records cleanly reset in PostgreSQL', 'success');
        handleRoute();
      } else {
        showToast('Failed to reset demo records', 'error');
      }
    });
  }

  handleRoute();
  initTechCursor();
}

// Route Dispatcher
function handleRoute() {
  const hash = window.location.hash.slice(2) || 'landing';
  const [route, param] = hash.split('/');
  state.currentRoute = route;

  const landingNav = document.getElementById('landing-navbar');
  const appNav = document.getElementById('app-navbar');

  // Toggle Navbar Mode
  if (route === 'landing' || route === '') {
    if (landingNav) landingNav.classList.remove('hidden');
    if (appNav) appNav.classList.add('hidden');
  } else {
    if (landingNav) landingNav.classList.add('hidden');
    if (appNav) appNav.classList.remove('hidden');
  }

  // Update navigation item active state for desktop app navbar
  document.querySelectorAll('.nav-item').forEach(item => {
    const itemRoute = item.getAttribute('data-route');
    if (itemRoute === route) {
      item.classList.remove('text-slate-600', 'hover:bg-slate-100', 'bg-brand-50', 'text-brand-700');
      item.classList.add('bg-brand-50', 'text-brand-700', 'font-bold', 'border', 'border-brand-200/60');
    } else {
      item.classList.remove('bg-brand-50', 'text-brand-700', 'font-bold', 'border', 'border-brand-200/60');
      item.classList.add('text-slate-600', 'hover:bg-slate-100');
    }
  });

  const root = document.getElementById('app-root');
  if (!root) return;

  // Render appropriate view
  switch (route) {
    case 'landing':
      renderLandingPage(root);
      break;
    case 'dashboard':
      renderDashboard(root);
      break;
    case 'payments':
      renderPayments(root, param);
      break;
    case 'recoveries':
      renderRecoveries(root, param);
      break;
    case 'manual-review':
      renderManualReview(root);
      break;
    case 'policies':
      renderPolicies(root);
      break;
    case 'simulator':
      renderSimulator(root);
      break;
    case 'recovery-studio':
      renderRecoveryStudio(root);
      break;
    default:
      renderLandingPage(root);
      break;
  }

  window.scrollTo(0, 0);
}

// =========================================================================
// 0. PHASE 14: PRODUCTION-QUALITY PUBLIC LANDING PAGE
// =========================================================================
function renderLandingPage(root) {
  root.innerHTML = `
    <div class="space-y-0 text-slate-800 antialiased selection:bg-brand-500 selection:text-white">
      
      <!-- ========================================== -->
      <!-- SECTION 1 — HERO SECTION (INTERACTIVE GLOW)-->
      <!-- ========================================== -->
      <section id="hero-section" class="relative overflow-hidden bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-white pt-16 pb-24 lg:pt-24 lg:pb-32">
        
        <!-- Architectural Background Grid & Ambient Movement -->
        <div class="absolute inset-0 bg-[linear-gradient(to_right,#1e293b15_1px,transparent_1px),linear-gradient(to_bottom,#1e293b15_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none"></div>
        
        <!-- Ambient Drift Background Glow -->
        <div class="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[320px] bg-brand-600/15 blur-[120px] rounded-full pointer-events-none animate-ambient"></div>
        
        <!-- Interactive Cursor-Responsive Radial Spotlight -->
        <div id="hero-radial-glow" class="absolute top-0 left-0 w-[500px] h-[500px] bg-gradient-to-tr from-brand-500/20 via-purple-500/15 to-transparent blur-[100px] rounded-full pointer-events-none transition-opacity duration-300 opacity-20"></div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div class="text-center max-w-3xl mx-auto space-y-6">
            
            <!-- Badge -->
            <div class="reveal-item inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-800/90 border border-slate-700 text-xs font-semibold text-brand-300 shadow-sm">
              <span class="w-2 h-2 rounded-full bg-emerald-400 badge-pulse"></span>
              <span>Intelligent Autonomous Recovery Engine &bull; Zero-Mock PostgreSQL</span>
            </div>

            <!-- Main Headline -->
            <h1 class="reveal-item delay-100 text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.15]">
              Recover Failed Payments. <br>
              <span class="bg-gradient-to-r from-brand-400 via-indigo-300 to-emerald-400 bg-clip-text text-transparent">Autonomously & Intelligently.</span>
            </h1>

            <!-- Subtitle -->
            <p class="reveal-item delay-200 text-base sm:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
              RecoverAI intercepts declined checkouts, classifies decline reasons, matches merchant policies, and coordinates high-converting recovery links, delayed retries, and multi-channel outreach to reclaim lost revenue.
            </p>

            <!-- Hero Action Buttons -->
            <div class="reveal-item delay-300 flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
              <a href="#/dashboard" class="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-sm shadow-lg shadow-brand-500/25 flex items-center justify-center space-x-2 transition-all hover:scale-[1.02] active:scale-[0.98]">
                <span>Try RecoverAI Live</span>
                <i data-lucide="arrow-right" class="w-4 h-4"></i>
              </a>
              <a href="#how-it-works" class="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-sm flex items-center justify-center space-x-2 transition-colors">
                <i data-lucide="play-circle" class="w-4 h-4 text-slate-400"></i>
                <span>See How It Works</span>
              </a>
            </div>

            <!-- Hero Feature Pills -->
            <div class="reveal-item delay-400 pt-4 flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-xs text-slate-400">
              <span class="flex items-center"><i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 mr-1.5"></i> 100% Real PostgreSQL Ledger</span>
              <span class="flex items-center"><i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 mr-1.5"></i> Single-Use Cryptographic Tokens</span>
              <span class="flex items-center"><i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400 mr-1.5"></i> Idempotent Multi-Method Retry</span>
            </div>

          </div>

          <!-- Hero Visual: Interactive Flow Node System -->
          <div class="reveal-item delay-500 mt-14 lg:mt-20 max-w-5xl mx-auto">
            <div class="bg-slate-800/90 border border-slate-700/80 rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-2xl shadow-black/50 hover:border-slate-600 transition-colors">
              <div class="flex items-center justify-between pb-4 border-b border-slate-700/80 text-xs">
                <div class="flex items-center space-x-2">
                  <span class="w-3 h-3 rounded-full bg-rose-500/80"></span>
                  <span class="w-3 h-3 rounded-full bg-amber-500/80"></span>
                  <span class="w-3 h-3 rounded-full bg-emerald-500/80"></span>
                  <span class="ml-2 font-mono text-slate-400 text-[11px]">recoverai-core-pipeline :: postgresql-live</span>
                </div>
                <span class="px-2.5 py-0.5 rounded-full bg-purple-900/60 border border-purple-500/40 text-purple-300 font-mono text-[10px] font-bold">SIMULATION ACTIVE</span>
              </div>

              <!-- Visual Workflow Node Map -->
              <div class="mt-6 grid grid-cols-1 md:grid-cols-5 gap-3 relative text-xs">
                <!-- Node 1: Payment Failed -->
                <div class="p-4 rounded-xl bg-slate-900/90 border border-rose-500/40 space-y-1.5 hover:border-rose-500/80 transition-all hover:scale-[1.02]">
                  <div class="flex items-center justify-between">
                    <span class="text-[10px] font-bold font-mono text-rose-400 uppercase">Stage 01</span>
                    <i data-lucide="x-circle" class="w-4 h-4 text-rose-400"></i>
                  </div>
                  <strong class="text-white block font-bold text-xs">Payment Failed</strong>
                  <p class="text-slate-400 text-[11px]">Card Insufficient Balance (₹1,499)</p>
                </div>

                <!-- Node 2: AI Ingestion -->
                <div class="p-4 rounded-xl bg-slate-900/90 border border-slate-700 space-y-1.5 hover:border-slate-600 transition-all hover:scale-[1.02]">
                  <div class="flex items-center justify-between">
                    <span class="text-[10px] font-bold font-mono text-slate-400 uppercase">Stage 02</span>
                    <i data-lucide="activity" class="w-4 h-4 text-brand-400"></i>
                  </div>
                  <strong class="text-white block font-bold text-xs">Decline Ingested</strong>
                  <p class="text-slate-400 text-[11px]">Taxonomy Classification</p>
                </div>

                <!-- Node 3: AI Policy Engine -->
                <div class="p-4 rounded-xl bg-slate-900/90 border border-purple-500/50 space-y-1.5 shadow-sm shadow-purple-500/10 hover:border-purple-500 transition-all hover:scale-[1.02]">
                  <div class="flex items-center justify-between">
                    <span class="text-[10px] font-bold font-mono text-purple-400 uppercase">Stage 03</span>
                    <i data-lucide="sparkles" class="w-4 h-4 text-purple-400"></i>
                  </div>
                  <strong class="text-white block font-bold text-xs">AI Policy Match</strong>
                  <p class="text-slate-400 text-[11px]">Strategy: Recovery Link (80%)</p>
                </div>

                <!-- Node 4: Outreach -->
                <div class="p-4 rounded-xl bg-slate-900/90 border border-indigo-500/40 space-y-1.5 hover:border-indigo-500 transition-all hover:scale-[1.02]">
                  <div class="flex items-center justify-between">
                    <span class="text-[10px] font-bold font-mono text-indigo-400 uppercase">Stage 04</span>
                    <i data-lucide="send" class="w-4 h-4 text-indigo-400"></i>
                  </div>
                  <strong class="text-white block font-bold text-xs">Simulated Dispatch</strong>
                  <p class="text-slate-400 text-[11px]">SMS & WhatsApp Outbox</p>
                </div>

                <!-- Node 5: Recovered -->
                <div class="p-4 rounded-xl bg-slate-900/90 border border-emerald-500/50 space-y-1.5 bg-emerald-950/20 hover:border-emerald-500 transition-all hover:scale-[1.02]">
                  <div class="flex items-center justify-between">
                    <span class="text-[10px] font-bold font-mono text-emerald-400 uppercase">Stage 05</span>
                    <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-400"></i>
                  </div>
                  <strong class="text-white block font-bold text-xs">Settled & Recovered</strong>
                  <p class="text-slate-400 text-[11px]">₹1,499.00 Reclaimed</p>
                </div>
              </div>

              <!-- Bottom Preview Callout -->
              <div class="mt-6 pt-4 border-t border-slate-700/60 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-3">
                <span class="flex items-center">
                  <i data-lucide="info" class="w-3.5 h-3.5 mr-1.5 text-brand-400"></i>
                  <span>Transparent execution pipeline with verifiable PostgreSQL audit logging.</span>
                </span>
                <a href="#/simulator" class="text-brand-400 hover:text-brand-300 font-bold flex items-center space-x-1">
                  <span>Open Simulator Studio</span>
                  <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                </a>
              </div>

            </div>
          </div>

        </div>
      </section>

      <!-- ========================================== -->
      <!-- SECTION 2 — THE PROBLEM                    -->
      <!-- ========================================== -->
      <section id="the-problem" class="py-20 lg:py-28 bg-white border-b border-slate-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="reveal-item text-center max-w-3xl mx-auto space-y-3">
            <span class="text-xs font-bold font-mono text-rose-600 uppercase tracking-wider">The Checkout Revenue Leak</span>
            <h2 class="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Failed checkouts are silent revenue killers.
            </h2>
            <p class="text-slate-600 text-sm sm:text-base leading-relaxed">
              When an online payment fails, merchants typically lose both the transaction and the customer. Most recovery tools blindly re-attempt cards without understanding the root cause.
            </p>
          </div>

          <!-- Problem Grid (Staggered Animation) -->
          <div class="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            
            <div class="reveal-item delay-100 p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                <i data-lucide="credit-card" class="w-5 h-5"></i>
              </div>
              <h3 class="text-base font-bold text-slate-900">Insufficient Balances</h3>
              <p class="text-xs text-slate-600 leading-relaxed">Customers encounter temporary balance shortages. Blind immediate retries fail and trigger card issuer security blocks.</p>
            </div>

            <div class="reveal-item delay-200 p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <i data-lucide="server-crash" class="w-5 h-5"></i>
              </div>
              <h3 class="text-base font-bold text-slate-900">Bank Gateway Timeouts</h3>
              <p class="text-xs text-slate-600 leading-relaxed">UPI and bank network outages drop active sessions. Customers abandon carts assuming the site is broken.</p>
            </div>

            <div class="reveal-item delay-300 p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <i data-lucide="shield-alert" class="w-5 h-5"></i>
              </div>
              <h3 class="text-base font-bold text-slate-900">High-Value Friction</h3>
              <p class="text-xs text-slate-600 leading-relaxed">Large transactions exceed standard risk thresholds without a human manager review mechanism.</p>
            </div>

            <div class="reveal-item delay-400 p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <i data-lucide="mail-warning" class="w-5 h-5"></i>
              </div>
              <h3 class="text-base font-bold text-slate-900">Manual Chasing</h3>
              <p class="text-xs text-slate-600 leading-relaxed">Merchants lack real-time automated workflows to dispatch single-use encrypted checkout links to customers.</p>
            </div>

          </div>

        </div>
      </section>

      <!-- ========================================== -->
      <!-- SECTION 3 — HOW RECOVERAI WORKS            -->
      <!-- ========================================== -->
      <section id="how-it-works" class="py-20 lg:py-28 bg-slate-50 border-b border-slate-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="reveal-item text-center max-w-3xl mx-auto space-y-3">
            <span class="text-xs font-bold font-mono text-brand-600 uppercase tracking-wider">End-to-End Architecture</span>
            <h2 class="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              How RecoverAI recovers payments in real time.
            </h2>
            <p class="text-slate-600 text-sm sm:text-base leading-relaxed">
              Every failed payment flows through a state-machine driven pipeline with deterministic failure classification and AI strategy selection.
            </p>
          </div>

          <!-- 6-Step Visual Progression Grid -->
          <div class="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            
            <!-- Step 1 -->
            <div class="reveal-item delay-100 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="flex items-center justify-between">
                <span class="w-8 h-8 rounded-xl bg-rose-50 text-rose-700 font-bold font-mono text-xs flex items-center justify-center">01</span>
                <i data-lucide="alert-octagon" class="w-5 h-5 text-rose-500"></i>
              </div>
              <h3 class="text-base font-bold text-slate-900">Payment Fails</h3>
              <p class="text-xs text-slate-600 leading-relaxed">The payment gateway webhook reports a declined or timed-out checkout. The transaction status is locked as FAILED in PostgreSQL.</p>
            </div>

            <!-- Step 2 -->
            <div class="reveal-item delay-200 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="flex items-center justify-between">
                <span class="w-8 h-8 rounded-xl bg-brand-50 text-brand-700 font-bold font-mono text-xs flex items-center justify-center">02</span>
                <i data-lucide="search" class="w-5 h-5 text-brand-500"></i>
              </div>
              <h3 class="text-base font-bold text-slate-900">Failure Classification</h3>
              <p class="text-xs text-slate-600 leading-relaxed">RecoverAI parses the decline code into customer-recoverable errors, temporary network glitches, or terminal hard declines.</p>
            </div>

            <!-- Step 3 -->
            <div class="reveal-item delay-300 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="flex items-center justify-between">
                <span class="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 font-bold font-mono text-xs flex items-center justify-center">03</span>
                <i data-lucide="sliders" class="w-5 h-5 text-purple-500"></i>
              </div>
              <h3 class="text-base font-bold text-slate-900">Policy Evaluation</h3>
              <p class="text-xs text-slate-600 leading-relaxed">Checks merchant-defined auto-recovery thresholds, quiet hours constraints, and previous retry attempt counters.</p>
            </div>

            <!-- Step 4 -->
            <div class="reveal-item delay-100 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="flex items-center justify-between">
                <span class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 font-bold font-mono text-xs flex items-center justify-center">04</span>
                <i data-lucide="zap" class="w-5 h-5 text-indigo-500"></i>
              </div>
              <h3 class="text-base font-bold text-slate-900">Strategy Selection</h3>
              <p class="text-xs text-slate-600 leading-relaxed">Assigns the optimal strategy: <strong>Recovery Link</strong>, <strong>Delayed Retry</strong>, <strong>Customer Reminder</strong>, or <strong>Manual Review</strong>.</p>
            </div>

            <!-- Step 5 -->
            <div class="reveal-item delay-200 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="flex items-center justify-between">
                <span class="w-8 h-8 rounded-xl bg-cyan-50 text-cyan-700 font-bold font-mono text-xs flex items-center justify-center">05</span>
                <i data-lucide="send" class="w-5 h-5 text-cyan-500"></i>
              </div>
              <h3 class="text-base font-bold text-slate-900">Customer Outreach</h3>
              <p class="text-xs text-slate-600 leading-relaxed">Generates a single-use cryptographic recovery token and dispatches simulated outreach across SMS, WhatsApp, or Email.</p>
            </div>

            <!-- Step 6 -->
            <div class="reveal-item delay-300 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="flex items-center justify-between">
                <span class="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 font-bold font-mono text-xs flex items-center justify-center">06</span>
                <i data-lucide="check-check" class="w-5 h-5 text-emerald-500"></i>
              </div>
              <h3 class="text-base font-bold text-slate-900">Payment Recovered</h3>
              <p class="text-xs text-slate-600 leading-relaxed">Customer completes retry on the frictionless recovery page. The recovery is logged as RECOVERED with verified transaction hash.</p>
            </div>

          </div>

        </div>
      </section>

      <!-- ========================================== -->
      <!-- SECTION 4 — INTELLIGENT RECOVERY           -->
      <!-- ========================================== -->
      <section id="intelligence" class="py-20 lg:py-28 bg-white border-b border-slate-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            
            <!-- Left Narrative (6 Cols) -->
            <div class="reveal-item lg:col-span-6 space-y-6">
              <span class="text-xs font-bold font-mono text-purple-600 uppercase tracking-wider">AI Decision Heuristics</span>
              <h2 class="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                Explainable, rule-grounded AI confidence scoring.
              </h2>
              <p class="text-slate-600 text-sm sm:text-base leading-relaxed">
                RecoverAI doesn't rely on unexplainable black boxes. Every recovery recommendation is scored through deterministic heuristics factoring failure severity, historical attempt penalties, and merchant policy limits.
              </p>

              <div class="space-y-3 pt-2 text-xs">
                <div class="flex items-start space-x-3">
                  <div class="w-6 h-6 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i data-lucide="check" class="w-3.5 h-3.5"></i>
                  </div>
                  <div>
                    <strong class="text-slate-900 font-bold block">Dynamic Confidence Calculation</strong>
                    <span class="text-slate-600">Calculates exact probability weights (e.g. 80% for Recovery Link, 90% for Delayed Retry).</span>
                  </div>
                </div>

                <div class="flex items-start space-x-3">
                  <div class="w-6 h-6 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i data-lucide="check" class="w-3.5 h-3.5"></i>
                  </div>
                  <div>
                    <strong class="text-slate-900 font-bold block">Manager Review Thresholds</strong>
                    <span class="text-slate-600">Automatically routes transactions exceeding merchant thresholds (e.g. &gt;₹20,000) to Manual Review.</span>
                  </div>
                </div>
              </div>

              <div class="pt-4">
                <a href="#/recovery-studio" class="inline-flex items-center space-x-2 text-sm font-bold text-purple-700 hover:text-purple-800">
                  <span>Explore AI Decision Studio</span>
                  <i data-lucide="arrow-right" class="w-4 h-4"></i>
                </a>
              </div>
            </div>

            <!-- Right Visual Component (6 Cols) -->
            <div class="reveal-item delay-200 lg:col-span-6 bg-slate-900 text-slate-100 rounded-3xl p-6 sm:p-8 shadow-xl space-y-5">
              <div class="flex items-center justify-between border-b border-slate-800 pb-3">
                <div class="flex items-center space-x-2">
                  <i data-lucide="sparkles" class="w-4 h-4 text-purple-400"></i>
                  <span class="text-xs font-bold text-purple-300">Live AI Decision Trace</span>
                </div>
                <span class="text-[11px] font-mono text-emerald-400">SCORE: 80% CONFIDENCE</span>
              </div>

              <div class="space-y-3 font-mono text-xs">
                <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700 space-y-1">
                  <span class="text-slate-400 text-[10px] block">SIGNAL EVALUATION</span>
                  <div class="flex justify-between text-slate-200">
                    <span>Failure Code:</span>
                    <span class="text-amber-400">INSUFFICIENT_FUNDS</span>
                  </div>
                  <div class="flex justify-between text-slate-200">
                    <span>Customer Recoverable:</span>
                    <span class="text-emerald-400">TRUE</span>
                  </div>
                  <div class="flex justify-between text-slate-200">
                    <span>Previous Retry Count:</span>
                    <span class="text-slate-300">0</span>
                  </div>
                </div>

                <div class="p-3 rounded-xl bg-purple-950/40 border border-purple-800/60 space-y-1 text-purple-200">
                  <span class="text-purple-400 text-[10px] block">POLICY ENGINE SELECTION</span>
                  <div class="flex justify-between">
                    <span>Selected Strategy:</span>
                    <span class="font-bold text-white">RECOVERY_LINK</span>
                  </div>
                  <div class="flex justify-between">
                    <span>Outreach Priority:</span>
                    <span class="text-purple-300">SMS &bull; WHATSAPP</span>
                  </div>
                  <div class="flex justify-between">
                    <span>Manager Review Required:</span>
                    <span class="text-emerald-400">FALSE</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

        </div>
      </section>

      <!-- ========================================== -->
      <!-- SECTION 5 — MULTI-CHANNEL RECOVERY         -->
      <!-- ========================================== -->
      <section id="multi-channel" class="py-20 lg:py-28 bg-slate-50 border-b border-slate-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="reveal-item text-center max-w-3xl mx-auto space-y-3">
            <span class="text-xs font-bold font-mono text-indigo-600 uppercase tracking-wider">Multi-Channel Routing</span>
            <h2 class="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Designed for multi-channel recovery outreach.
            </h2>
            <p class="text-slate-600 text-sm sm:text-base leading-relaxed">
              RecoverAI dispatches personalized payment links directly to where customers are. The current demo runs in <strong>Simulation Mode</strong> with honest delivery tracking and gateway-ready provider contracts.
            </p>
          </div>

          <!-- Channel Grid (Staggered Animation) -->
          <div class="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6">
            
            <div class="reveal-item delay-100 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 text-center sm:text-left hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto sm:mx-0">
                <i data-lucide="message-square" class="w-5 h-5"></i>
              </div>
              <div class="flex items-center justify-between">
                <h3 class="text-base font-bold text-slate-900">SMS Outreach</h3>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 font-mono">SIMULATED</span>
              </div>
              <p class="text-xs text-slate-600 leading-relaxed">Instant SMS dispatch with short recovery URLs. Perfect for immediate notification when card or UPI checkouts fail.</p>
            </div>

            <div class="reveal-item delay-200 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 text-center sm:text-left hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto sm:mx-0">
                <i data-lucide="phone-call" class="w-5 h-5"></i>
              </div>
              <div class="flex items-center justify-between">
                <h3 class="text-base font-bold text-slate-900">WhatsApp Messages</h3>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 font-mono">SIMULATED</span>
              </div>
              <p class="text-xs text-slate-600 leading-relaxed">Rich messaging templates with interactive payment buttons for high-engagement mobile checkouts.</p>
            </div>

            <div class="reveal-item delay-300 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 text-center sm:text-left hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto sm:mx-0">
                <i data-lucide="mail" class="w-5 h-5"></i>
              </div>
              <div class="flex items-center justify-between">
                <h3 class="text-base font-bold text-slate-900">Email Notifications</h3>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 font-mono">SIMULATED</span>
              </div>
              <p class="text-xs text-slate-600 leading-relaxed">Branded itemized checkout summaries with 1-click retry buttons for desktop and subscription merchants.</p>
            </div>

          </div>

        </div>
      </section>

      <!-- ========================================== -->
      <!-- SECTION 6 — MERCHANT CONTROL               -->
      <!-- ========================================== -->
      <section id="merchant-control" class="py-20 lg:py-28 bg-white border-b border-slate-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="reveal-item text-center max-w-3xl mx-auto space-y-3">
            <span class="text-xs font-bold font-mono text-emerald-600 uppercase tracking-wider">Enterprise Control</span>
            <h2 class="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Complete control and visibility for merchants.
            </h2>
            <p class="text-slate-600 text-sm sm:text-base leading-relaxed">
              Every recovered rupee, active campaign, and policy threshold is visible in your real-time PostgreSQL-backed dashboard.
            </p>
          </div>

          <div class="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6">
            
            <div class="reveal-item delay-100 p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="flex items-center space-x-2 text-slate-900 font-bold text-sm">
                <i data-lucide="trending-up" class="w-4 h-4 text-emerald-600"></i>
                <span>Revenue Saved Metrics</span>
              </div>
              <p class="text-xs text-slate-600 leading-relaxed">Real-time aggregation of recovered capital, campaign recovery rates, and checkout health.</p>
            </div>

            <div class="reveal-item delay-200 p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="flex items-center space-x-2 text-slate-900 font-bold text-sm">
                <i data-lucide="sliders" class="w-4 h-4 text-brand-600"></i>
                <span>Policy Customization</span>
              </div>
              <p class="text-xs text-slate-600 leading-relaxed">Set custom auto-recovery limits, configure quiet hours protection, and prioritize recovery strategies.</p>
            </div>

            <div class="reveal-item delay-300 p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 hover:border-slate-300 transition-all hover:scale-[1.01]">
              <div class="flex items-center space-x-2 text-slate-900 font-bold text-sm">
                <i data-lucide="user-check" class="w-4 h-4 text-amber-600"></i>
                <span>Manual Review Queue</span>
              </div>
              <p class="text-xs text-slate-600 leading-relaxed">One-click approve or dismiss queue for high-value transactions exceeding policy limits.</p>
            </div>

          </div>

          <div class="reveal-item delay-400 mt-10 text-center">
            <a href="#/dashboard" class="inline-flex items-center space-x-2 px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs transition-colors">
              <span>Open Merchant Dashboard</span>
              <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
            </a>
          </div>

        </div>
      </section>

      <!-- ========================================== -->
      <!-- SECTION 7 — DEMO / TRY IT CONVERSION       -->
      <!-- ========================================== -->
      <section class="py-20 lg:py-28 bg-gradient-to-br from-brand-900 via-slate-900 to-indigo-950 text-white relative overflow-hidden">
        <div class="reveal-item max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6 relative z-10">
          
          <div class="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-brand-800/80 border border-brand-700 text-xs font-semibold text-brand-200">
            <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
            <span>Interactive Hackathon Demo Ready</span>
          </div>

          <h2 class="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            Experience RecoverAI in Action.
          </h2>

          <p class="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
            Trigger simulated payment failures, inspect live AI decisions, experience the customer recovery checkout portal, and verify immutable settlement records in PostgreSQL.
          </p>

          <div class="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-4">
            <a href="#/simulator" class="w-full sm:w-auto px-8 py-4 rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-bold text-sm shadow-xl shadow-brand-500/30 flex items-center justify-center space-x-2 transition-all hover:scale-[1.02] active:scale-[0.98]">
              <i data-lucide="play-circle" class="w-4 h-4"></i>
              <span>Launch Simulator Studio</span>
            </a>
            <a href="#/dashboard" class="w-full sm:w-auto px-8 py-4 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-white border border-slate-700 font-bold text-sm flex items-center justify-center space-x-2 transition-colors">
              <i data-lucide="layout-dashboard" class="w-4 h-4"></i>
              <span>View Live Dashboard</span>
            </a>
          </div>

        </div>
      </section>

      <!-- ========================================== -->
      <!-- SECTION 8 — CLEAN TRUTHFUL FOOTER          -->
      <!-- ========================================== -->
      <footer class="bg-white border-t border-slate-200 py-12">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div class="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-slate-200 text-xs">
            
            <!-- Col 1: Branding -->
            <div class="space-y-3">
              <div class="flex items-center space-x-2">
                <div class="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-xs">
                  <i data-lucide="shield-alert" class="w-3.5 h-3.5"></i>
                </div>
                <span class="text-base font-extrabold tracking-tight text-slate-900">
                  Recover<span class="text-brand-600">AI</span>
                </span>
              </div>
              <p class="text-slate-500 leading-relaxed">
                Autonomous payment recovery engine powered by rule-based heuristics and verifiable PostgreSQL ledger.
              </p>
            </div>

            <!-- Col 2: Navigation -->
            <div class="space-y-2">
              <strong class="text-slate-900 block font-bold">Platform</strong>
              <div class="space-y-1.5 text-slate-600">
                <div><a href="#/dashboard" class="hover:text-slate-900">Dashboard</a></div>
                <div><a href="#/payments" class="hover:text-slate-900">Payments Ledger</a></div>
                <div><a href="#/recoveries" class="hover:text-slate-900">Recovery Campaigns</a></div>
                <div><a href="#/manual-review" class="hover:text-slate-900">Manual Review Queue</a></div>
              </div>
            </div>

            <!-- Col 3: Intelligence & Tools -->
            <div class="space-y-2">
              <strong class="text-slate-900 block font-bold">Intelligence</strong>
              <div class="space-y-1.5 text-slate-600">
                <div><a href="#/simulator" class="hover:text-slate-900">Simulator Studio</a></div>
                <div><a href="#/recovery-studio" class="hover:text-slate-900">AI Decision Studio</a></div>
                <div><a href="#/policies" class="hover:text-slate-900">Recovery Policies</a></div>
              </div>
            </div>

            <!-- Col 4: Hackathon Disclaimer -->
            <div class="space-y-2">
              <strong class="text-slate-900 block font-bold">Environment</strong>
              <p class="text-slate-500 text-[11px] leading-relaxed">
                Built for Hackathon Demonstration. Powered by Docker, Node.js, Express, and PostgreSQL with honest simulated messaging dispatches.
              </p>
            </div>

          </div>

          <div class="pt-6 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-400 space-y-2 sm:space-y-0">
            <div>&copy; 2026 RecoverAI &bull; Autonomous Payment Recovery Engine.</div>
            <div class="flex items-center space-x-4">
              <span>Stack: Node 20 &bull; PostgreSQL 15 &bull; Docker</span>
            </div>
          </div>

        </div>
      </footer>

    </div>
  `;
  lucide.createIcons();
  setupScrollReveal();
  setupHeroGlow();
}

// ==========================================
// 1. DASHBOARD VIEW
// ==========================================
async function renderDashboard(root) {
  root.innerHTML = `
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 animate-fadeIn max-w-full overflow-hidden">
      <!-- Top Overview Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Recovery Dashboard</h1>
          <p class="text-slate-500 text-xs sm:text-sm mt-1">Live metrics, automated recovery revenue performance, and campaign activity.</p>
        </div>
        <div class="flex items-center space-x-2.5">
          <button onclick="handleRoute()" class="px-3.5 py-2 rounded-xl border border-slate-200 hover:border-slate-300 bg-white text-slate-700 font-semibold text-xs flex items-center space-x-1.5 shadow-xs transition-colors">
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            <span>Refresh</span>
          </button>
          <a href="#/simulator" class="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs flex items-center space-x-1.5 shadow-xs transition-colors">
            <i data-lucide="play" class="w-3.5 h-3.5"></i>
            <span>Simulator Studio</span>
          </a>
        </div>
      </div>

      <!-- SKELETON METRICS -->
      <div id="dash-metrics-container" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        <div class="h-32 bg-white rounded-2xl border border-slate-200 p-6 animate-pulse"></div>
        <div class="h-32 bg-white rounded-2xl border border-slate-200 p-6 animate-pulse"></div>
        <div class="h-32 bg-white rounded-2xl border border-slate-200 p-6 animate-pulse"></div>
        <div class="h-32 bg-white rounded-2xl border border-slate-200 p-6 animate-pulse"></div>
      </div>

      <!-- TWO-COLUMN LAYOUT: Strategy Performance & Recent Activity -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        <!-- Strategy Breakdown (7 Cols) -->
        <div class="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm sm:text-base font-bold text-slate-900 flex items-center space-x-2">
              <i data-lucide="zap" class="w-4 h-4 text-brand-600"></i>
              <span>Strategy Recovery Performance</span>
            </h2>
            <span class="text-[11px] font-semibold text-slate-500 font-mono">PostgreSQL Ledger</span>
          </div>
          <div id="dash-strategies-list" class="space-y-3 pt-1">
            <div class="h-16 bg-slate-100 rounded-xl animate-pulse"></div>
            <div class="h-16 bg-slate-100 rounded-xl animate-pulse"></div>
          </div>
        </div>

        <!-- Recent Activity Feed (5 Cols) -->
        <div class="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm sm:text-base font-bold text-slate-900 flex items-center space-x-2">
              <i data-lucide="activity" class="w-4 h-4 text-emerald-600"></i>
              <span>Recent Campaign Activity</span>
            </h2>
            <a href="#/recoveries" class="text-xs font-semibold text-brand-600 hover:underline">View All &rarr;</a>
          </div>
          <div id="dash-activity-list" class="divide-y divide-slate-100">
            <div class="py-3 h-12 bg-slate-100 rounded-lg animate-pulse mb-2"></div>
            <div class="py-3 h-12 bg-slate-100 rounded-lg animate-pulse"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();

  // Load live metrics
  const res = await api('/merchant/dashboard');
  if (!res.ok) {
    showToast('Failed to load dashboard metrics', 'error');
    return;
  }

  const m = res.data.data;
  state.dashboardMetrics = m;

  // Render Metric KPI Cards
  const mContainer = document.getElementById('dash-metrics-container');
  mContainer.innerHTML = `
    <!-- Total Recovered Revenue -->
    <div class="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden group hover:border-emerald-300 transition-colors">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Recovered Revenue</span>
        <div class="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <i data-lucide="trending-up" class="w-4 h-4"></i>
        </div>
      </div>
      <div class="mt-3">
        <span class="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono tracking-tight">${formatINR(m.totalRecoveredAmount)}</span>
      </div>
      <div class="mt-2 text-xs font-semibold text-emerald-700 flex items-center">
        <i data-lucide="check" class="w-3.5 h-3.5 mr-1 flex-shrink-0"></i>
        <span>${formatPercent(m.recoveryRate)} Overall Recovery Rate</span>
      </div>
    </div>

    <!-- Active Recovery Campaigns -->
    <div class="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden group hover:border-brand-300 transition-colors">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Active Campaigns</span>
        <div class="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
          <i data-lucide="refresh-cw" class="w-4 h-4"></i>
        </div>
      </div>
      <div class="mt-3">
        <span class="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono tracking-tight">${m.activeRecoveries}</span>
      </div>
      <div class="mt-2 text-xs font-semibold text-slate-500 flex items-center">
        <span>In Outreach & Verification</span>
      </div>
    </div>

    <!-- Total Payments Processed -->
    <div class="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden group hover:border-slate-300 transition-colors">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Checkouts</span>
        <div class="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
          <i data-lucide="credit-card" class="w-4 h-4"></i>
        </div>
      </div>
      <div class="mt-3">
        <span class="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono tracking-tight">${m.totalPayments}</span>
      </div>
      <div class="mt-2 text-xs font-semibold text-slate-500">
        <span>${m.successfulPayments} Succeeded &bull; ${m.failedPayments} Declined</span>
      </div>
    </div>

    <!-- Checkout Success Rate -->
    <div class="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden group hover:border-amber-300 transition-colors">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Checkout Health</span>
        <div class="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
          <i data-lucide="pie-chart" class="w-4 h-4"></i>
        </div>
      </div>
      <div class="mt-3">
        <span class="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono tracking-tight">${formatPercent(m.paymentSuccessRate)}</span>
      </div>
      <div class="mt-2 text-xs font-semibold text-amber-700">
        <span>AI Recovery Interventions</span>
      </div>
    </div>
  `;

  // Render Strategy Breakdown
  const stratList = document.getElementById('dash-strategies-list');
  if (m.strategyPerformance && m.strategyPerformance.length > 0) {
    stratList.innerHTML = m.strategyPerformance.map(s => {
      const rate = parseFloat(s.successRate) || 0;
      const displayRate = formatPercent(rate);
      const stratName = formatStrategy(s.strategyId);

      return `
        <div class="p-3.5 sm:p-4 rounded-xl border border-slate-100 bg-slate-50/70 space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2 min-w-0">
              <span class="px-2 py-0.5 rounded text-xs font-bold font-mono ${s.strategyId === 'RECOVERY_LINK' ? 'bg-indigo-100 text-indigo-800' : (s.strategyId === 'DELAYED_RETRY' ? 'bg-amber-100 text-amber-800' : 'bg-purple-100 text-purple-800')}">
                ${stratName}
              </span>
              <span class="text-[11px] text-slate-500 truncate">${s.totalCampaigns} triggered</span>
            </div>
            <span class="text-xs font-extrabold font-mono text-emerald-700 flex-shrink-0">${displayRate} Success</span>
          </div>
          <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
            <div class="bg-emerald-500 h-full rounded-full transition-all duration-500" style="width: ${Math.min(100, Math.max(0, rate <= 1 ? rate * 100 : rate))}%"></div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    stratList.innerHTML = `<div class="py-8 text-center text-xs text-slate-400">No strategy campaigns recorded yet. Run a simulation to see live performance.</div>`;
  }

  // Render Recent Activity Feed
  const actList = document.getElementById('dash-activity-list');
  if (m.recentActivity && m.recentActivity.length > 0) {
    actList.innerHTML = m.recentActivity.map(a => {
      const isRecovered = a.status === 'RECOVERED';
      const statusBadge = isRecovered
        ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">RECOVERED</span>`
        : `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">${a.status}</span>`;

      return `
        <div class="py-3 flex items-center justify-between text-xs hover:bg-slate-50/80 px-2 rounded-lg transition-colors">
          <div class="min-w-0 pr-2">
            <div class="font-bold text-slate-800 font-mono">${formatINR(a.amount)}</div>
            <div class="text-slate-400 text-[11px] font-mono mt-0.5 truncate">${new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &bull; ID: ${a.recovery_id.slice(0, 8)}...</div>
          </div>
          <div class="flex-shrink-0">${statusBadge}</div>
        </div>
      `;
    }).join('');
  } else {
    actList.innerHTML = `<div class="py-8 text-center text-xs text-slate-400">No recent activity found.</div>`;
  }

  lucide.createIcons();
}

// ==========================================
// 2. PAYMENTS VIEW
// ==========================================
async function renderPayments(root) {
  root.innerHTML = `
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 animate-fadeIn max-w-full overflow-hidden">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Payments Ledger</h1>
          <p class="text-slate-500 text-xs sm:text-sm mt-1">Immutable record of all checkout attempts ingested by RecoverAI.</p>
        </div>
        <div class="flex items-center space-x-2.5">
          <select id="payment-filter-status" class="bg-white border border-slate-200 text-xs font-semibold rounded-xl px-3 py-2 focus:ring-2 focus:ring-brand-500 shadow-xs">
            <option value="">All Statuses</option>
            <option value="SUCCESSFUL">SUCCESSFUL</option>
            <option value="FAILED">FAILED</option>
            <option value="INITIATED">INITIATED</option>
          </select>
          <button onclick="handleRoute()" class="p-2 rounded-xl border border-slate-200 hover:border-slate-300 bg-white text-slate-600 shadow-xs">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
          </button>
        </div>
      </div>

      <div class="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs min-w-[640px]">
            <thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
              <tr>
                <th class="py-3.5 px-4">Payment ID</th>
                <th class="py-3.5 px-4">Amount</th>
                <th class="py-3.5 px-4">Status</th>
                <th class="py-3.5 px-4">Method</th>
                <th class="py-3.5 px-4">Failure Reason</th>
                <th class="py-3.5 px-4">Created At</th>
                <th class="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="payments-tbody" class="divide-y divide-slate-100">
              <tr><td colspan="7" class="py-8 text-center text-slate-400">Loading payments ledger...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Payment Detail Modal -->
      <div id="payment-modal" class="hidden fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 class="text-base font-bold text-slate-900">Payment Breakdown</h3>
            <button onclick="document.getElementById('payment-modal').classList.add('hidden')" class="text-slate-400 hover:text-slate-600 p-1">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>
          <div id="payment-modal-content" class="space-y-4 text-xs"></div>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();

  const filterSelect = document.getElementById('payment-filter-status');
  filterSelect.addEventListener('change', () => loadPaymentsList(filterSelect.value));

  await loadPaymentsList('');
}

async function loadPaymentsList(status) {
  const tbody = document.getElementById('payments-tbody');
  const url = status ? `/merchant/payments?status=${status}` : '/merchant/payments';
  const res = await api(url);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-rose-600">Failed to load payments from PostgreSQL.</td></tr>`;
    return;
  }

  const payments = res.data.data || [];
  if (payments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">No payment records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = payments.map(p => {
    const isSuccess = p.status === 'SUCCESSFUL';
    const statusPill = isSuccess
      ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">SUCCESSFUL</span>`
      : (p.status === 'FAILED'
        ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">FAILED</span>`
        : `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-800">${p.status}</span>`);

    const failureDesc = p.failure_type_id ? formatFailureCode(p.failure_type_id) : '&mdash;';

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3 px-4 font-mono font-bold text-slate-800">
          <span title="${p.payment_id}">${p.payment_id.slice(0, 8)}...</span>
        </td>
        <td class="py-3 px-4 font-mono font-extrabold text-slate-900">${formatINR(p.amount)}</td>
        <td class="py-3 px-4">${statusPill}</td>
        <td class="py-3 px-4 font-medium text-slate-600">${p.payment_method_id || 'CARD'}</td>
        <td class="py-3 px-4 text-slate-700 font-medium">${failureDesc}</td>
        <td class="py-3 px-4 text-slate-500">${new Date(p.created_at).toLocaleDateString()} ${new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td class="py-3 px-4 text-right">
          <button onclick="viewPaymentDetail('${p.payment_id}')" class="px-2.5 py-1 rounded-lg border border-slate-200 hover:border-brand-300 hover:text-brand-600 font-semibold text-slate-600 transition-colors">
            Inspect
          </button>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

async function viewPaymentDetail(paymentId) {
  const modal = document.getElementById('payment-modal');
  const content = document.getElementById('payment-modal-content');
  modal.classList.remove('hidden');
  content.innerHTML = `<div class="py-6 text-center text-slate-400">Loading details...</div>`;

  const res = await api(`/merchant/payments/${paymentId}`);
  if (!res.ok) {
    content.innerHTML = `<div class="text-rose-600">Failed to load payment detail.</div>`;
    return;
  }

  const p = res.data.data;
  content.innerHTML = `
    <!-- Human-Readable Key Details Card -->
    <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      <div class="flex justify-between items-center pb-2 border-b border-slate-200">
        <span class="text-slate-500 font-medium">Transaction Amount</span>
        <span class="text-base font-extrabold text-slate-900 font-mono">${formatINR(p.amount)}</span>
      </div>
      <div class="flex justify-between items-center">
        <span class="text-slate-500">Status</span>
        <span class="font-bold ${p.status === 'SUCCESSFUL' ? 'text-emerald-700' : 'text-rose-700'}">${p.status}</span>
      </div>
      <div class="flex justify-between items-center">
        <span class="text-slate-500">Failure Classification</span>
        <span class="font-semibold text-slate-800">${p.failure_type_id ? formatFailureCode(p.failure_type_id) : 'None'}</span>
      </div>
      <div class="flex justify-between items-center">
        <span class="text-slate-500">Payment Method</span>
        <span class="font-medium text-slate-800">${p.payment_method_id || 'CARD'}</span>
      </div>
      <div class="flex justify-between items-center">
        <span class="text-slate-500">Environment</span>
        <span class="font-mono text-slate-600">${p.environment}</span>
      </div>
      <div class="flex justify-between items-center text-[11px] pt-1 border-t border-slate-200">
        <span class="text-slate-400">Payment UUID</span>
        <span class="font-mono text-slate-600 truncate max-w-[200px]">${p.payment_id}</span>
      </div>
    </div>

    ${p.recovery ? `
      <div class="p-4 rounded-xl bg-indigo-50 border border-indigo-200 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-indigo-900">Linked Recovery Campaign</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-indigo-200 text-indigo-800">${p.recovery.status}</span>
        </div>
        <div class="text-xs text-indigo-700">Stage: <strong>${formatStage(p.recovery.current_stage)}</strong></div>
        <div class="pt-1">
          <a href="#/recoveries" class="inline-flex items-center space-x-1 text-xs font-bold text-brand-600 hover:underline">
            <span>View Recovery Timeline</span>
            <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
          </a>
        </div>
      </div>
    ` : ''}

    <!-- Expandable Technical Payload for Judges/Devs -->
    <details class="group bg-white border border-slate-200 rounded-xl p-3 text-xs">
      <summary class="font-bold text-slate-700 cursor-pointer flex items-center justify-between select-none">
        <span>View Technical PostgreSQL Record</span>
        <i data-lucide="chevron-down" class="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform"></i>
      </summary>
      <pre class="mt-2 p-2 bg-slate-900 text-slate-200 rounded-lg text-[10px] font-mono overflow-x-auto max-h-48">${JSON.stringify(p, null, 2)}</pre>
    </details>
  `;
  lucide.createIcons();
}

// ==========================================
// 3. RECOVERIES VIEW
// ==========================================
async function renderRecoveries(root) {
  root.innerHTML = `
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 animate-fadeIn max-w-full overflow-hidden">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Recovery Campaigns</h1>
          <p class="text-slate-500 text-xs sm:text-sm mt-1">Autonomous recovery campaigns orchestrated across multi-channel retries.</p>
        </div>
        <div class="flex items-center space-x-2.5">
          <button onclick="handleRoute()" class="p-2 rounded-xl border border-slate-200 hover:border-slate-300 bg-white text-slate-600 shadow-xs">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
          </button>
        </div>
      </div>

      <div class="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs min-w-[700px]">
            <thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
              <tr>
                <th class="py-3.5 px-4">Recovery ID</th>
                <th class="py-3.5 px-4">Amount</th>
                <th class="py-3.5 px-4">Status</th>
                <th class="py-3.5 px-4">Current Stage</th>
                <th class="py-3.5 px-4">Strategy</th>
                <th class="py-3.5 px-4">AI Confidence</th>
                <th class="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="recoveries-tbody" class="divide-y divide-slate-100">
              <tr><td colspan="7" class="py-8 text-center text-slate-400">Loading recoveries...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recovery Timeline Detail Modal -->
      <div id="recovery-modal" class="hidden fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-5 sm:p-7 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 class="text-base sm:text-lg font-bold text-slate-900">Recovery Campaign Lifecycle</h3>
              <p class="text-[11px] text-slate-500 font-mono" id="rec-modal-id"></p>
            </div>
            <button onclick="document.getElementById('recovery-modal').classList.add('hidden')" class="text-slate-400 hover:text-slate-600 p-1">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>
          <div id="recovery-modal-content" class="space-y-5"></div>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();

  await loadRecoveriesList();
}

async function loadRecoveriesList() {
  const tbody = document.getElementById('recoveries-tbody');
  const res = await api('/merchant/recoveries');

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-rose-600">Failed to load recoveries.</td></tr>`;
    return;
  }

  const recoveries = res.data.data || [];
  if (recoveries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">No active or historical recovery campaigns.</td></tr>`;
    return;
  }

  tbody.innerHTML = recoveries.map(r => {
    const isRecovered = r.status === 'RECOVERED';
    const statusPill = isRecovered
      ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">RECOVERED</span>`
      : (r.status === 'FAILED'
        ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">FAILED</span>`
        : `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">${r.status}</span>`);

    const stratName = formatStrategy(r.selected_strategy_id);
    const confidenceDisplay = formatPercent(r.ai_confidence_score || 0.80);

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3 px-4 font-mono font-bold text-slate-800">
          <span title="${r.recovery_id}">${r.recovery_id.slice(0, 8)}...</span>
        </td>
        <td class="py-3 px-4 font-mono font-extrabold text-slate-900">${formatINR(r.amount)}</td>
        <td class="py-3 px-4">${statusPill}</td>
        <td class="py-3 px-4 font-semibold text-slate-700">${formatStage(r.current_stage)}</td>
        <td class="py-3 px-4 font-mono text-xs font-bold text-indigo-700">${stratName}</td>
        <td class="py-3 px-4 font-mono font-bold text-slate-800">${confidenceDisplay}</td>
        <td class="py-3 px-4 text-right">
          <button onclick="viewRecoveryDetail('${r.recovery_id}')" class="px-3 py-1 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 font-bold transition-colors">
            Timeline
          </button>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

async function viewRecoveryDetail(recoveryId) {
  const modal = document.getElementById('recovery-modal');
  const modalId = document.getElementById('rec-modal-id');
  const content = document.getElementById('recovery-modal-content');
  modal.classList.remove('hidden');
  modalId.textContent = `ID: ${recoveryId}`;
  content.innerHTML = `<div class="py-8 text-center text-slate-400">Loading campaign details...</div>`;

  const res = await api(`/merchant/recoveries/${recoveryId}`);
  if (!res.ok) {
    content.innerHTML = `<div class="text-rose-600">Failed to load recovery timeline.</div>`;
    return;
  }

  const d = res.data.data;
  const r = d.recovery;
  const actions = d.actions || [];
  const attempts = d.attempts || [];

  const isSuccess = r.status === 'RECOVERED';
  const confidence = formatPercent(r.ai_confidence_score || 0.80);

  content.innerHTML = `
    <!-- Top Metrics Overview -->
    <div class="grid grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
      <div>
        <span class="text-slate-500 block font-medium">Recoverable Amount</span>
        <span class="font-extrabold text-brand-600 font-mono text-base">${formatINR(r.amount)}</span>
      </div>
      <div>
        <span class="text-slate-500 block font-medium">Status</span>
        <span class="font-bold ${isSuccess ? 'text-emerald-700' : 'text-slate-900'}">${r.status}</span>
      </div>
      <div>
        <span class="text-slate-500 block font-medium">Strategy & Confidence</span>
        <span class="font-bold text-purple-700 font-mono">${formatStrategy(r.selected_strategy_id)} (${confidence})</span>
      </div>
    </div>

    <!-- Execution Timeline Stepper -->
    <div class="space-y-3">
      <h4 class="text-xs font-bold text-slate-900 uppercase tracking-wider">Campaign Progression</h4>
      <div class="space-y-4 border-l-2 border-slate-200 pl-4 ml-2 text-xs">
        <div class="relative">
          <div class="w-3 h-3 rounded-full bg-rose-500 absolute -left-[23px] top-1"></div>
          <div class="font-bold text-slate-800">1. Payment Checkout Failed</div>
          <div class="text-slate-500">Declined checkout ingested and classified into recovery queue.</div>
        </div>
        <div class="relative">
          <div class="w-3 h-3 rounded-full bg-brand-500 absolute -left-[23px] top-1"></div>
          <div class="font-bold text-slate-800">2. AI Policy Engine Selected Strategy</div>
          <div class="text-slate-500">Strategy: <strong class="font-mono text-slate-700">${formatStrategy(r.selected_strategy_id)}</strong> &bull; Confidence: <strong class="font-mono text-slate-700">${confidence}</strong></div>
        </div>
        <div class="relative">
          <div class="w-3 h-3 rounded-full ${actions.length > 0 ? 'bg-brand-500' : 'bg-slate-300'} absolute -left-[23px] top-1"></div>
          <div class="font-bold text-slate-800">3. Outbound Outreach Dispatched</div>
          <div class="text-slate-500">${actions.length > 0 ? `${actions.length} action(s) logged in ledger.` : 'Awaiting outreach action.'}</div>
        </div>
        <div class="relative">
          <div class="w-3 h-3 rounded-full ${attempts.length > 0 ? 'bg-emerald-500' : 'bg-slate-300'} absolute -left-[23px] top-1"></div>
          <div class="font-bold text-slate-800">4. Payment Retry & Settlement</div>
          <div class="text-slate-500">${attempts.length > 0 ? `Retry Status: ${attempts[0].status}` : 'Pending customer checkout action.'}</div>
        </div>
        <div class="relative">
          <div class="w-3 h-3 rounded-full ${isSuccess ? 'bg-emerald-500' : 'bg-slate-300'} absolute -left-[23px] top-1"></div>
          <div class="font-bold text-slate-800">5. Campaign Completed</div>
          <div class="text-slate-500">${isSuccess ? `Recovered at ${new Date(r.completed_at).toLocaleString()}` : 'Campaign in progress.'}</div>
        </div>
      </div>
    </div>

    <!-- Expandable Technical Details -->
    <details class="group bg-white border border-slate-200 rounded-xl p-3 text-xs">
      <summary class="font-bold text-slate-700 cursor-pointer flex items-center justify-between select-none">
        <span>View Technical Payload</span>
        <i data-lucide="chevron-down" class="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform"></i>
      </summary>
      <pre class="mt-2 p-2 bg-slate-900 text-slate-200 rounded-lg text-[10px] font-mono overflow-x-auto max-h-48">${JSON.stringify(d, null, 2)}</pre>
    </details>
  `;
  lucide.createIcons();
}

// ==========================================
// 4. MANUAL REVIEW VIEW
// ==========================================
async function renderManualReview(root) {
  root.innerHTML = `
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 animate-fadeIn max-w-full overflow-hidden">
      <div>
        <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Manual Review Queue</h1>
        <p class="text-slate-500 text-xs sm:text-sm mt-1">High-value transactions or risk-flagged campaigns requiring merchant manager authorization.</p>
      </div>

      <div id="manual-queue-container" class="space-y-4">
        <div class="py-12 text-center text-slate-400">Checking manual review queue...</div>
      </div>
    </div>
  `;
  lucide.createIcons();

  const res = await api('/merchant/recoveries');
  const container = document.getElementById('manual-queue-container');

  if (!res.ok) {
    container.innerHTML = `<div class="p-6 bg-rose-50 text-rose-700 rounded-xl text-xs">Failed to load manual review queue.</div>`;
    return;
  }

  const all = res.data.data || [];
  const pending = all.filter(r => r.approval_required === true || r.current_stage === 'ANALYSIS');

  // Update navbar badge count
  const badge = document.getElementById('nav-manual-badge');
  const mBadge = document.getElementById('nav-manual-mobile-badge');
  if (badge) {
    if (pending.length > 0) {
      badge.textContent = pending.length;
      badge.classList.remove('hidden');
      if (mBadge) { mBadge.textContent = pending.length; mBadge.classList.remove('hidden'); }
    } else {
      badge.classList.add('hidden');
      if (mBadge) mBadge.classList.add('hidden');
    }
  }

  if (pending.length === 0) {
    container.innerHTML = `
      <div class="bg-white border border-slate-200 rounded-2xl p-10 sm:p-12 text-center max-w-md mx-auto space-y-3 shadow-xs">
        <div class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
          <i data-lucide="check-check" class="w-6 h-6"></i>
        </div>
        <h3 class="text-base font-bold text-slate-900">Review Queue is Clear</h3>
        <p class="text-xs text-slate-500">No campaigns currently require manual review. Run Demo Scenario C in the Simulator to trigger a high-value review case.</p>
        <a href="#/simulator" class="inline-block mt-2 px-4 py-2 rounded-xl bg-brand-600 text-white font-bold text-xs shadow-xs">Open Simulator</a>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = pending.map(r => `
    <div class="bg-white border-2 border-amber-200 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div class="space-y-1.5 min-w-0">
        <div class="flex items-center space-x-2">
          <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">MANAGER APPROVAL REQUIRED</span>
          <span class="text-xs text-slate-400 font-mono truncate">ID: ${r.recovery_id.slice(0, 12)}...</span>
        </div>
        <div class="text-2xl font-extrabold text-slate-900 font-mono">${formatINR(r.amount)}</div>
        <div class="text-xs text-slate-600">Threshold exceeded auto-recovery policy limit &bull; Strategy: <strong class="font-mono text-purple-700">${formatStrategy(r.selected_strategy_id)}</strong></div>
      </div>
      <div class="flex items-center space-x-3 w-full md:w-auto flex-shrink-0">
        <button onclick="approveCampaign('${r.recovery_id}')" class="flex-1 md:flex-none px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-xs transition-colors">
          <i data-lucide="check" class="w-4 h-4"></i>
          <span>Approve & Launch Outreach</span>
        </button>
        <button onclick="resolveCampaign('${r.recovery_id}', 'CLOSE_FAILED')" class="flex-1 md:flex-none px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-700 font-bold text-xs flex items-center justify-center space-x-1.5 border border-slate-200 transition-colors">
          <i data-lucide="x" class="w-4 h-4"></i>
          <span>Dismiss</span>
        </button>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

async function approveCampaign(recoveryId) {
  const res = await api(`/merchant/recoveries/${recoveryId}/approve`, { method: 'POST' });
  if (res.ok) {
    showToast('Campaign approved successfully! Outreach dispatched.', 'success');
    renderManualReview(document.getElementById('app-root'));
  } else {
    showToast('Failed to approve campaign', 'error');
  }
}

async function resolveCampaign(recoveryId, resolution) {
  const res = await api(`/merchant/recoveries/${recoveryId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution, cancellationReason: 'Dismissed during manager manual review.' })
  });
  if (res.ok) {
    showToast('Campaign resolved and updated in PostgreSQL.', 'info');
    renderManualReview(document.getElementById('app-root'));
  } else {
    showToast('Failed to resolve campaign', 'error');
  }
}

// ==========================================
// 5. POLICIES VIEW
// ==========================================
async function renderPolicies(root) {
  root.innerHTML = `
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 animate-fadeIn max-w-4xl overflow-hidden">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Recovery Policies</h1>
          <p class="text-slate-500 text-xs sm:text-sm mt-1">Configure automated recovery rules, thresholds, and outreach priority.</p>
        </div>
      </div>

      <div id="policy-content-box" class="space-y-6">
        <div class="py-12 text-center text-slate-400">Loading merchant policy...</div>
      </div>
    </div>
  `;
  lucide.createIcons();

  const res = await api('/merchant/policy');
  const box = document.getElementById('policy-content-box');

  if (!res.ok || !res.data.data) {
    box.innerHTML = `<div class="p-6 bg-rose-50 text-rose-700 rounded-xl text-xs">Failed to load active policy.</div>`;
    return;
  }

  const p = res.data.data;
  box.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl p-5 sm:p-8 shadow-xs space-y-6">
      <div class="flex items-center justify-between pb-4 border-b border-slate-100">
        <div>
          <h3 class="text-base font-bold text-slate-900">Autonomous Recovery Engine</h3>
          <p class="text-xs text-slate-500 mt-0.5">Automatically trigger intelligent outreach when checkout declines occur.</p>
        </div>
        <span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
          ${p.auto_recovery_enabled ? 'ENABLED' : 'DISABLED'}
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
          <span class="text-slate-500 font-semibold block">Auto-Recovery Limit</span>
          <span class="text-xl font-bold text-slate-900 font-mono">${formatINR(p.max_amount_limit || 5000)}</span>
          <span class="text-slate-400 text-[11px] block">Transactions exceeding this limit escalate to Manager Review.</span>
        </div>
        <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
          <span class="text-slate-500 font-semibold block">Quiet Hours Protection</span>
          <span class="text-xl font-bold text-slate-900 font-mono">${p.quiet_hours_enabled ? `${p.quiet_hours_start} &ndash; ${p.quiet_hours_end}` : 'Disabled'}</span>
          <span class="text-slate-400 text-[11px] block">Suppresses customer SMS/WhatsApp during sleeping hours.</span>
        </div>
      </div>

      <div class="space-y-3 pt-4 border-t border-slate-100">
        <h4 class="text-xs font-bold text-slate-900 uppercase tracking-wider">Strategy Execution Priority</h4>
        <div class="space-y-2">
          ${(p.strategies || []).map(s => `
            <div class="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between text-xs">
              <div class="flex items-center space-x-3">
                <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-xs font-mono">${s.priority_order}</span>
                <div>
                  <span class="font-bold text-slate-800">${formatStrategy(s.strategy_id)}</span>
                  <span class="text-[11px] text-slate-400 font-mono block sm:inline sm:ml-2">ID: ${s.strategy_id}</span>
                </div>
              </div>
              <span class="px-2.5 py-0.5 rounded text-[11px] font-bold ${s.is_enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}">
                ${s.is_enabled ? 'ACTIVE' : 'PAUSED'}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();
}

// ==========================================
// 6. SIMULATOR & DEMO WORKFLOW RUNNER
// ==========================================
async function renderSimulator(root) {
  root.innerHTML = `
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 animate-fadeIn max-w-5xl overflow-hidden">
      <div>
        <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Payment Failure Simulator</h1>
        <p class="text-slate-500 text-xs sm:text-sm mt-1">Simulate realistic checkout declines and watch RecoverAI execute autonomous recovery in Simulation Mode.</p>
      </div>

      <!-- Quick Preset Demo Scenarios -->
      <div class="space-y-3">
        <h3 class="text-xs font-bold text-slate-900 uppercase tracking-wider">Quick Hackathon Demo Scenarios</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div onclick="fillSimulator('1499.00', 'CARD', 'INSUFFICIENT_FUNDS')" class="p-4 bg-white border border-slate-200 hover:border-brand-500 rounded-2xl shadow-xs cursor-pointer transition-all hover:scale-[1.01] group">
            <div class="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center mb-2.5">
              <i data-lucide="link" class="w-4 h-4"></i>
            </div>
            <h4 class="text-sm font-bold text-slate-900 group-hover:text-brand-600">Scenario A: Recovery Link</h4>
            <p class="text-xs text-slate-500 mt-0.5">₹1,499 &bull; Card &bull; Insufficient Funds</p>
          </div>

          <div onclick="fillSimulator('899.00', 'UPI', 'TEMPORARY_BANK_ISSUE')" class="p-4 bg-white border border-slate-200 hover:border-amber-500 rounded-2xl shadow-xs cursor-pointer transition-all hover:scale-[1.01] group">
            <div class="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-2.5">
              <i data-lucide="clock" class="w-4 h-4"></i>
            </div>
            <h4 class="text-sm font-bold text-slate-900 group-hover:text-amber-600">Scenario B: Delayed Retry</h4>
            <p class="text-xs text-slate-500 mt-0.5">₹899 &bull; UPI &bull; Bank Network Issue</p>
          </div>

          <div onclick="fillSimulator('25000.00', 'CARD', 'INSUFFICIENT_FUNDS')" class="p-4 bg-white border border-slate-200 hover:border-purple-500 rounded-2xl shadow-xs cursor-pointer transition-all hover:scale-[1.01] group">
            <div class="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-2.5">
              <i data-lucide="shield-alert" class="w-4 h-4"></i>
            </div>
            <h4 class="text-sm font-bold text-slate-900 group-hover:text-purple-600">Scenario C: Manual Review</h4>
            <p class="text-xs text-slate-500 mt-0.5">₹25,000 &bull; High Value Threshold</p>
          </div>

          <div onclick="fillSimulator('3500.00', 'CARD', 'SUCCESS')" class="p-4 bg-white border border-slate-200 hover:border-emerald-500 rounded-2xl shadow-xs cursor-pointer transition-all hover:scale-[1.01] group">
            <div class="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2.5">
              <i data-lucide="check-circle" class="w-4 h-4"></i>
            </div>
            <h4 class="text-sm font-bold text-slate-900 group-hover:text-emerald-600">Scenario D: Normal Success</h4>
            <p class="text-xs text-slate-500 mt-0.5">₹3,500 &bull; Success Checkout</p>
          </div>
        </div>
      </div>

      <!-- Simulator Config Form & Live Result Box -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        <!-- Form (5 Cols) -->
        <div class="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4 h-fit">
          <h3 class="text-xs font-bold text-slate-900 uppercase tracking-wider">Configure Checkout Attempt</h3>

          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">Payment Amount (INR)</label>
            <input type="number" id="sim-amount" value="1499.00" step="0.01" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono text-slate-900 focus:ring-2 focus:ring-brand-500">
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">Payment Method</label>
            <select id="sim-method" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-brand-500">
              <option value="CARD">Card (Debit/Credit)</option>
              <option value="UPI">UPI</option>
              <option value="NET_BANKING">Net Banking</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">Outcome / Decline Code</label>
            <select id="sim-outcome" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-brand-500">
              <option value="INSUFFICIENT_FUNDS">Insufficient Balance (Customer Recoverable)</option>
              <option value="TEMPORARY_BANK_ISSUE">Temporary Bank Issue (Auto Retry)</option>
              <option value="NETWORK_ERROR">Gateway Network Error (Temporary Failure)</option>
              <option value="UPI_TIMEOUT">UPI Timeout (Temporary Failure)</option>
              <option value="SUCCESS">Success (Normal Succeeded)</option>
            </select>
          </div>

          <div class="pt-2">
            <button id="btn-run-sim" onclick="executeSimulatorRun()" class="w-full py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-xs flex items-center justify-center space-x-2 transition-transform active:scale-[0.99]">
              <i data-lucide="play" class="w-4 h-4"></i>
              <span id="btn-run-sim-text">Trigger Simulated Payment</span>
              <span id="btn-run-sim-spinner" class="hidden ml-2 animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
            </button>
          </div>
        </div>

        <!-- Live Stepper Output (7 Cols) -->
        <div class="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div class="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 class="text-xs font-bold text-slate-900 uppercase tracking-wider">Simulation Output & Pipeline</h3>
            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 font-mono">SIMULATION</span>
          </div>

          <div id="sim-output-box" class="space-y-4">
            <div class="py-16 text-center text-slate-400 text-xs">
              Configure and click &ldquo;Trigger Simulated Payment&rdquo; above to inspect the live RecoverAI execution pipeline.
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();
}

function fillSimulator(amount, method, outcome) {
  document.getElementById('sim-amount').value = amount;
  document.getElementById('sim-method').value = method;
  document.getElementById('sim-outcome').value = outcome;
}

async function executeSimulatorRun() {
  const btn = document.getElementById('btn-run-sim');
  const text = document.getElementById('btn-run-sim-text');
  const spinner = document.getElementById('btn-run-sim-spinner');
  const outputBox = document.getElementById('sim-output-box');

  btn.disabled = true;
  text.textContent = 'Processing Pipeline...';
  spinner.classList.remove('hidden');

  const amount = document.getElementById('sim-amount').value;
  const paymentMethodId = document.getElementById('sim-method').value;
  const simulateOutcome = document.getElementById('sim-outcome').value;

  const res = await api('/demo/recovery-flow/run', {
    method: 'POST',
    body: JSON.stringify({ amount, paymentMethodId, simulateOutcome })
  });

  btn.disabled = false;
  text.textContent = 'Trigger Simulated Payment';
  spinner.classList.add('hidden');

  if (!res.ok || !res.data.success) {
    outputBox.innerHTML = `<div class="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">Simulation run failed: ${res.data?.error?.message || 'Unknown error'}</div>`;
    return;
  }

  const d = res.data.data;
  const trace = res.data.trace || [];
  const stratName = formatStrategy(d.strategy);
  const confidence = formatPercent(d.confidence || 0.80);

  let portalUrl = d.recoveryUrl;
  if (portalUrl && portalUrl.includes('/customer/recovery/')) {
    const tok = portalUrl.split('/customer/recovery/')[1];
    portalUrl = `/customer-portal?token=${tok}`;
  }

  outputBox.innerHTML = `
    <!-- Top Result Banner -->
    <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-3">
      <div class="flex items-center justify-between">
        <span class="font-bold text-slate-800">Pipeline Result</span>
        <span class="px-2.5 py-0.5 rounded text-xs font-bold font-mono ${d.strategy === 'RECOVERY_LINK' ? 'bg-indigo-100 text-indigo-800' : (d.strategy === 'DELAYED_RETRY' ? 'bg-amber-100 text-amber-800' : 'bg-purple-100 text-purple-800')}">
          ${stratName}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-slate-600 text-xs">
        <div>Amount: <strong class="text-slate-900 font-mono">${formatINR(amount)}</strong></div>
        <div>Confidence: <strong class="text-emerald-700 font-mono">${confidence}</strong></div>
      </div>
    </div>

    <!-- Human-Readable Stepper Trace -->
    <div class="space-y-3 border-l-2 border-slate-200 pl-4 ml-2 text-xs">
      ${trace.map(t => {
        let structuredContent = '';
        if (t.step === 1) {
          structuredContent = `<div class="text-[11px] text-slate-600">Payment: <strong>${formatINR(amount)}</strong> &bull; Method: <strong>${paymentMethodId}</strong> &bull; Status: <strong class="text-rose-600">Declined</strong></div>`;
        } else if (t.step === 2) {
          structuredContent = `<div class="text-[11px] text-slate-600">Classification: <strong>${formatFailureCode(simulateOutcome)}</strong></div>`;
        } else if (t.step === 4) {
          structuredContent = `<div class="text-[11px] text-slate-600">Recommended: <strong class="text-purple-700">${stratName}</strong> &bull; Confidence: <strong>${confidence}</strong></div>`;
        } else if (t.step === 7) {
          structuredContent = `<div class="text-[11px] text-slate-600">Outreach: <strong class="text-indigo-700 font-bold">SIMULATED SMS / WhatsApp</strong> &bull; Status: <strong class="text-emerald-700">Dispatched</strong></div>`;
        } else {
          structuredContent = `<div class="text-[11px] text-slate-500">${t.name} recorded in PostgreSQL.</div>`;
        }

        return `
          <div class="relative py-1">
            <div class="w-2.5 h-2.5 rounded-full bg-brand-500 absolute -left-[21px] top-2"></div>
            <div class="font-bold text-slate-900">${t.step}. ${t.name}</div>
            ${structuredContent}
          </div>
        `;
      }).join('')}
    </div>

    <!-- AI Decision Presentation Card -->
    <div class="p-4 rounded-xl bg-purple-50/70 border border-purple-200 text-xs space-y-2">
      <div class="flex items-center justify-between">
        <span class="font-bold text-purple-900 flex items-center space-x-1.5">
          <i data-lucide="sparkles" class="w-4 h-4 text-purple-600"></i>
          <span>AI Recovery Decision</span>
        </span>
        <span class="font-mono text-purple-800 font-bold">${confidence} Match</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-purple-900">
        <div>Strategy: <strong>${stratName}</strong></div>
        <div>Manager Review: <strong>${d.requiresApproval ? 'Yes' : 'No (Autonomous)'}</strong></div>
      </div>
      <p class="text-[11px] text-purple-700 leading-relaxed">
        ${d.strategy === 'RECOVERY_LINK' 
          ? 'Customer-recoverable payment failure detected. Recovery link provides lowest-friction recovery path.' 
          : (d.strategy === 'DELAYED_RETRY' 
            ? 'Temporary bank network timeout detected. Automated delayed retry scheduled.' 
            : 'High-value transaction flagged for manual review.')}
      </p>
    </div>

    <!-- Notification Delivery Panel (Honest Simulation) -->
    <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
      <div class="flex items-center justify-between">
        <span class="font-bold text-slate-800 flex items-center space-x-1.5">
          <i data-lucide="send" class="w-3.5 h-3.5 text-slate-600"></i>
          <span>Notification Outreach</span>
        </span>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">SIMULATED</span>
      </div>
      <div class="grid grid-cols-3 gap-2 text-[11px]">
        <div class="p-2 bg-white rounded-lg border border-slate-200 text-center">
          <span class="text-slate-400 block">Channel</span>
          <strong class="text-slate-800">SMS</strong>
        </div>
        <div class="p-2 bg-white rounded-lg border border-slate-200 text-center">
          <span class="text-slate-400 block">Template</span>
          <strong class="text-slate-800">Recovery Link</strong>
        </div>
        <div class="p-2 bg-white rounded-lg border border-slate-200 text-center">
          <span class="text-slate-400 block">Status</span>
          <strong class="text-emerald-700">DISPATCHED</strong>
        </div>
      </div>
    </div>

    ${portalUrl ? `
      <!-- Customer Recovery Action Card -->
      <div class="p-4 rounded-xl bg-indigo-50 border border-indigo-200 space-y-3">
        <div>
          <h4 class="text-xs font-bold text-indigo-900">Customer Recovery Portal</h4>
          <p class="text-xs text-indigo-700 mt-0.5">The customer can complete payment using the secure recovery page.</p>
        </div>
        
        <div class="flex flex-col sm:flex-row gap-2">
          <a href="${portalUrl}" target="_blank" class="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-xs">
            <span>Open Recovery Page</span>
            <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
          </a>
          <button onclick="copyToClipboard(window.location.origin + '${portalUrl}')" class="px-4 py-2 rounded-xl bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 font-bold text-xs flex items-center justify-center space-x-1.5 shadow-xs">
            <i data-lucide="copy" class="w-3.5 h-3.5"></i>
            <span>Copy Link</span>
          </button>
        </div>

        <div class="pt-1">
          <span class="text-[10px] text-slate-400 font-medium block mb-1">Generated URL:</span>
          <div class="p-2 bg-white border border-indigo-200 rounded-lg text-[11px] font-mono text-slate-700 break-all select-all">
            ${window.location.origin}${portalUrl}
          </div>
        </div>
      </div>
    ` : ''}

    ${d.strategy === 'DELAYED_RETRY' ? `
      <div class="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
        <div class="text-xs font-bold text-amber-900">Scheduled Retry Simulation</div>
        <button onclick="triggerDelayedRetry('${d.recoveryId}')" class="px-4 py-2.5 rounded-xl bg-amber-600 text-white font-bold text-xs hover:bg-amber-700 shadow-xs">
          Execute Scheduled Retry Now
        </button>
      </div>
    ` : ''}

    <!-- Expandable Technical Details -->
    <details class="group bg-white border border-slate-200 rounded-xl p-3 text-xs">
      <summary class="font-bold text-slate-700 cursor-pointer flex items-center justify-between select-none">
        <span>View Technical Execution Payload</span>
        <i data-lucide="chevron-down" class="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform"></i>
      </summary>
      <pre class="mt-2 p-2 bg-slate-900 text-slate-200 rounded-lg text-[10px] font-mono overflow-x-auto max-h-48">${JSON.stringify(d, null, 2)}</pre>
    </details>
  `;
  lucide.createIcons();
}

async function triggerDelayedRetry(recoveryId) {
  const res = await api(`/demo/recovery/${recoveryId}/execute-delayed-retry`, {
    method: 'POST',
    body: JSON.stringify({ simulateOutcome: 'SUCCESS' })
  });
  if (res.ok) {
    showToast('Delayed retry executed successfully! Campaign RECOVERED.', 'success');
    executeSimulatorRun();
  } else {
    showToast('Failed to execute delayed retry', 'error');
  }
}

// ==========================================
// 7. AI STUDIO & DECISION EXPLAINER
// ==========================================
function renderRecoveryStudio(root) {
  root.innerHTML = `
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 animate-fadeIn max-w-4xl overflow-hidden">
      <div>
        <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">RecoverAI Intelligence Studio</h1>
        <p class="text-slate-500 text-xs sm:text-sm mt-1">Inspect the rule-based policy engine, heuristic confidence scoring, and multi-channel outreach routing.</p>
      </div>

      <div class="bg-white border border-slate-200 rounded-2xl p-5 sm:p-8 shadow-xs space-y-6">
        <h3 class="text-xs font-bold text-slate-900 uppercase tracking-wider">How RecoverAI Evaluates Declines</h3>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <span class="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-700 font-bold flex items-center justify-center font-mono">1</span>
            <strong class="text-slate-900 block font-semibold text-sm">Failure Classification</strong>
            <p class="text-slate-500 leading-relaxed">Decline taxonomy identifies whether failure is bank network related or customer actionable.</p>
          </div>
          <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <span class="w-7 h-7 rounded-lg bg-purple-50 text-purple-700 font-bold flex items-center justify-center font-mono">2</span>
            <strong class="text-slate-900 block font-semibold text-sm">Policy Evaluation</strong>
            <p class="text-slate-500 leading-relaxed">Validates merchant amount limits, threshold rules, quiet hours, and customer blacklist.</p>
          </div>
          <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <span class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 font-bold flex items-center justify-center font-mono">3</span>
            <strong class="text-slate-900 block font-semibold text-sm">Outreach Routing</strong>
            <p class="text-slate-500 leading-relaxed">Dispatches single-use cryptographic recovery tokens via preferred channels.</p>
          </div>
        </div>

        <div class="p-4 rounded-xl bg-slate-900 text-slate-200 font-mono text-xs space-y-1.5">
          <div class="text-emerald-400 font-bold font-sans">Confidence Scoring Formula</div>
          <p class="text-slate-400">Confidence = BaseStrategyScore &times; FailureWeight &minus; (AttemptPenalty &times; PreviousFailures)</p>
          <p class="text-slate-400">Recovery Link: 80% baseline | Delayed Retry: 90% baseline | Reminder: 65% baseline</p>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();
}

// Kickoff Single Page Application
document.addEventListener('DOMContentLoaded', initRouter);
