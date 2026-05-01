// ==UserScript==
// @name         Percival Mobile
// @namespace    percival
// @version      1.2.0
// @description  GBF Raid Automator for iOS
// @match        https://game.granbluefantasy.jp/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  // ==========================================================
  // Settings
  // ==========================================================

  function getSetting(key, defaultValue) {
    try {
      const gmValue = GM_getValue(key);
      if (gmValue !== undefined) return gmValue;
    } catch (e) {}

    try {
      const lsValue = localStorage.getItem('percival_' + key);
      if (lsValue !== null) return JSON.parse(lsValue);
    } catch (e) {}

    return defaultValue;
  }

  function setSetting(key, value) {
    try { GM_setValue(key, value); } catch (e) {}
    try { localStorage.setItem('percival_' + key, JSON.stringify(value)); } catch (e) {}
  }

  let settings = {
    autoRaid:      getSetting('autoRaid',      true),
    autoCombat:    getSetting('autoCombat',    true),
    quickAttack:   getSetting('quickAttack',   false),
    reloadAttack:  getSetting('reloadAttack',  false),
    reloadSummon:  getSetting('reloadSummon',  false)
  };

  function saveSetting(key, value) {
    settings[key] = value;
    setSetting(key, value);
  }

  console.log('Settings loaded:', JSON.stringify(settings));

  // ==========================================================
  // Network Interception
  // Must run at document-start before game JS loads
  // ==========================================================

  let reloadPending = false;

  function handleNetworkUrl(url) {
    if (!url) return;

    const isAttack = url.includes('normal_attack_result.json');
    const isSummon = url.includes('summon_result.json');

    if ((isAttack && settings.reloadAttack) || (isSummon && settings.reloadSummon)) {
      if (!reloadPending) {
        reloadPending = true;
        const delay = 500 + Math.random() * 500;
        console.log(`🔄 Percival: Reloading after ${isAttack ? 'attack' : 'summon'} in ${Math.round(delay)}ms`);
        setTimeout(() => {
          reloadPending = false;
          window.location.reload();
        }, delay);
      }
    }
  }

  // Patch fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const response = await originalFetch.apply(this, args);
    handleNetworkUrl(url);
    return response;
  };

  // Patch XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.addEventListener('load', () => handleNetworkUrl(url));
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  // ==========================================================
  // State
  // ==========================================================

  const state = {
    active:             true,
    currentScreen:      'unknown',
    lastUrl:            window.location.href,
    raidInProgress:     false,
    autoCombatActive:   false,
    autoClickAttempted: false,
    hasSeenAutoButton:  false,
    lastCheck:          0,
    reloading:          false
  };

  const cooldowns = {
    ok:     0,
    attack: 0,
    auto:   0
  };

  const timing = {
    COOLDOWN:           2000 + Math.random() * 3000,
    CHECK_INTERVAL:     800  + Math.random() * 700,
    HUMAN_DELAY_CHANCE: 0.3,
    HUMAN_DELAY_MIN:    500,
    HUMAN_DELAY_MAX:    3000,
  };

  // ==========================================================
  // UI
  // ==========================================================

  function buildUI() {
    const existing = document.getElementById('percival-pill');
    if (existing) existing.remove();

    const pill = document.createElement('div');
    pill.id = 'percival-pill';
    Object.assign(pill.style, {
      position:         'fixed',
      bottom:           '20px',
      right:            '16px',
      zIndex:           '2147483647',
      fontFamily:       'sans-serif',
      fontSize:         '12px',
      userSelect:       'none',
      webkitUserSelect: 'none'
    });

    // Collapsed Button
    const collapsed = document.createElement('div');
    Object.assign(collapsed.style, {
      background:   '#333',
      color:        'white',
      padding:      '6px 12px',
      borderRadius: '20px',
      cursor:       'pointer',
      display:      'flex',
      alignItems:   'center',
      gap:          '6px',
      boxShadow:    '0 2px 8px rgba(0,0,0,0.3)'
    });

    const dot = document.createElement('span');
    dot.id          = 'percival-dot';
    dot.textContent = '●';
    dot.style.color = state.active ? '#4CAF50' : '#ff9800';

    const label       = document.createElement('span');
    label.textContent = 'Percival';

    collapsed.appendChild(dot);
    collapsed.appendChild(label);

    // Expanded Panel
    const panel = document.createElement('div');
    panel.id = 'percival-panel';
    Object.assign(panel.style, {
      display:      'none',
      background:   '#222',
      color:        'white',
      borderRadius: '12px',
      padding:      '12px',
      marginBottom: '8px',
      boxShadow:    '0 2px 12px rgba(0,0,0,0.4)',
      minWidth:     '180px'
    });

    // Status Line
    const status = document.createElement('div');
    status.id = 'percival-status';
    Object.assign(status.style, {
      fontSize:     '10px',
      color:        '#aaa',
      marginBottom: '10px',
      padding:      '4px 6px',
      background:   '#333',
      borderRadius: '6px'
    });
    status.textContent = 'Ready';
    panel.appendChild(status);

    // Toggles
    const toggleDefs = [
      { key: 'autoRaid',     label: 'Auto Raid'        },
      { key: 'autoCombat',   label: 'Full Auto'        },
      { key: 'quickAttack',  label: 'Quick Attack'     },
      { key: 'reloadAttack', label: 'Reload on Attack' },
      { key: 'reloadSummon', label: 'Reload on Summon' }
    ];

    toggleDefs.forEach(({ key, label }) => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        marginBottom:   '8px'
      });

      const lbl          = document.createElement('span');
      lbl.textContent    = label;
      lbl.style.fontSize = '12px';

      const toggle = document.createElement('div');
      toggle.id = `percival-toggle-${key}`;
      Object.assign(toggle.style, {
        width:        '36px',
        height:       '20px',
        borderRadius: '10px',
        background:   settings[key] ? '#4CAF50' : '#555',
        position:     'relative',
        cursor:       'pointer',
        transition:   'background 0.2s'
      });

      const thumb = document.createElement('div');
      Object.assign(thumb.style, {
        width:        '16px',
        height:       '16px',
        background:   'white',
        borderRadius: '50%',
        position:     'absolute',
        top:          '2px',
        left:         settings[key] ? '18px' : '2px',
        transition:   'left 0.2s'
      });

      toggle.appendChild(thumb);
      toggle.addEventListener('click', () => {
        const newVal            = !settings[key];
        saveSetting(key, newVal);
        toggle.style.background = newVal ? '#4CAF50' : '#555';
        thumb.style.left        = newVal ? '18px'   : '2px';
      });

      row.appendChild(lbl);
      row.appendChild(toggle);
      panel.appendChild(row);
    });

    // Pause/Resume Button
    const pauseBtn = document.createElement('button');
    pauseBtn.id          = 'percival-pause';
    pauseBtn.textContent = state.active ? 'Pause' : 'Resume';
    Object.assign(pauseBtn.style, {
      width:        '100%',
      padding:      '7px',
      marginTop:    '4px',
      background:   state.active ? '#ff9800' : '#4CAF50',
      color:        'white',
      border:       'none',
      borderRadius: '8px',
      cursor:       'pointer',
      fontSize:     '12px',
      fontWeight:   '500'
    });

    pauseBtn.addEventListener('click', () => {
      state.active              = !state.active;
      pauseBtn.textContent      = state.active ? 'Pause'   : 'Resume';
      pauseBtn.style.background = state.active ? '#ff9800' : '#4CAF50';
      dot.style.color           = state.active ? '#4CAF50' : '#ff9800';
      updateStatus(state.active ? 'Resumed' : 'Paused');
    });

    panel.appendChild(pauseBtn);

    // Toggle Panel on Pill Click
    collapsed.addEventListener('click', () => {
      const isOpen        = panel.style.display !== 'none';
      panel.style.display = isOpen ? 'none' : 'block';
    });

    pill.appendChild(panel);
    pill.appendChild(collapsed);
    document.body.appendChild(pill);
  }

  function updateStatus(message) {
    const el  = document.getElementById('percival-status');
    const dot = document.getElementById('percival-dot');
    if (el)  el.textContent  = message;
    if (dot) dot.style.color = state.active ? '#4CAF50' : '#ff9800';
  }

  // ==========================================================
  // Utilities
  // ==========================================================

  function getRandomDelay(min, max) {
    return min + Math.random() * (max - min);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function canClick(type) {
    return Date.now() - cooldowns[type] > timing.COOLDOWN;
  }

  // ==========================================================
  // Click Simulation
  // ==========================================================

  async function simulateClick(element, actionName) {
    if (!element) return false;

    try {
      await sleep(getRandomDelay(100, 300));

      element.click();

      const rect = element.getBoundingClientRect();
      const x    = rect.left + rect.width  / 2;
      const y    = rect.top  + rect.height / 2;

      try {
        element.dispatchEvent(new TouchEvent('touchstart', {
          bubbles: true, cancelable: true,
          touches: [new Touch({ identifier: 1, target: element, clientX: x, clientY: y })]
        }));
        await sleep(50);
        element.dispatchEvent(new TouchEvent('touchend', {
          bubbles: true, cancelable: true,
          changedTouches: [new Touch({ identifier: 1, target: element, clientX: x, clientY: y })]
        }));
      } catch (e) {}

      element.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1
      }));
      await sleep(50);
      element.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 0
      }));
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
      }));

      updateStatus(actionName);
      return true;
    } catch (e) {
      try {
        element.click();
        updateStatus(actionName);
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  // ==========================================================
  // Element Finders
  // ==========================================================

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect  = element.getBoundingClientRect();
    return style.display    !== 'none'   &&
           style.visibility !== 'hidden' &&
           rect.width  > 0 &&
           rect.height > 0;
  }

  function findQuestStartButton() {
    const deckContainer  = document.querySelector('.prt-btn-deck');
    const questContainer = document.querySelector('.prt-set-quest');

    const b1 = deckContainer?.querySelector('.btn-usual-ok.se-quest-start');
    const b2 = deckContainer?.querySelector('.btn-usual-ok.btn-silent-se');
    const b3 = questContainer?.querySelector('.btn-quest-start.multi.se-quest-start');

    if (b1 && isVisible(b1)) return b1;
    if (b2 && isVisible(b2)) return b2;
    if (b3 && isVisible(b3)) return b3;

    return null;
  }

  function findAutoButton() {
    const container = document.querySelector('.cnt-raid');
    const btn       = container?.querySelector('.btn-auto');
    return btn && isVisible(btn) ? btn : null;
  }

  function findAttackButton() {
    const container = document.querySelector('#cnt-raid-information');
    const btn       = container?.querySelector('.btn-attack-start');
    return btn && isVisible(btn) ? btn : null;
  }

  function findDeadBoss() {
    const hp = document.getElementById('enemy-hp0');
    return hp && hp.textContent.trim() === '0';
  }

  function findDismissablePopup() {
    const popup = document.querySelector('.pop-usual');
    if (!popup) return false;

    const isBattleEnded = !!popup.querySelector('.txt-rematch-fail');
    const isExpGained   = popup.querySelector('.prt-popup-header')?.textContent?.trim() === 'EXP Gained';

    return isBattleEnded || isExpGained;
  }

  function findPopupButton() {
    const popup = document.querySelector('.pop-usual');
    if (!popup) return null;

    const isBattleEnded = !!popup.querySelector('.txt-rematch-fail');
    const isExpGained   = popup.querySelector('.prt-popup-header')?.textContent?.trim() === 'EXP Gained';

    if (!isBattleEnded && !isExpGained) return null;

    const btn = popup.querySelector('.btn-usual-ok, .btn-usual-close');
    return btn && isVisible(btn) ? btn : null;
  }

  // ==========================================================
  // Screen Detection
  // ==========================================================

  function detectCurrentScreen() {
    const previousScreen = state.currentScreen;
    const currentUrl     = window.location.href;
    const urlChanged     = state.lastUrl !== currentUrl;

    const okButton       = findQuestStartButton();
    const autoButton     = findAutoButton();
    const isStartScreen  = okButton   && isVisible(okButton);
    const isBattleScreen = autoButton && isVisible(autoButton);

    if (isStartScreen) {
      state.currentScreen = 'start';

      if (previousScreen === 'battle' && state.raidInProgress) {
        updateStatus('Raid Complete!');
      }

      state.raidInProgress     = false;
      state.autoCombatActive   = false;
      state.autoClickAttempted = false;
      state.hasSeenAutoButton  = false;
      state.reloading          = false;

    } else if (isBattleScreen) {
      state.currentScreen = 'battle';

      if (!state.raidInProgress) {
        state.raidInProgress     = true;
        state.hasSeenAutoButton  = false;
        state.autoCombatActive   = false;
        state.autoClickAttempted = false;
        updateStatus('Raid In Progress...');
      }

      if (!state.hasSeenAutoButton) state.hasSeenAutoButton = true;

    } else if (urlChanged && previousScreen === 'battle' && state.raidInProgress) {
      const wasBattleUrl   = state.lastUrl.includes('/#raid/')  || state.lastUrl.includes('/#battle/');
      const isNotBattleUrl = !currentUrl.includes('/#raid/')    && !currentUrl.includes('/#battle/');

      if (wasBattleUrl && isNotBattleUrl) {
        state.raidInProgress = false;
        updateStatus('Raid Complete!');
      }
    }

    state.lastUrl = currentUrl;
  }

  // ==========================================================
  // Button Checks
  // ==========================================================

  async function checkButtons() {
    if (!state.active) return;

    // Handle Auto-Dismissable Popups
    if (findDismissablePopup()) {
      const btn = findPopupButton();
      if (btn) await simulateClick(btn, 'Closing Popup');
      return;
    }

    // Boss HP Check - Always On
    if (state.currentScreen === 'battle' && findDeadBoss() && !state.reloading) {
      state.reloading = true;
      updateStatus('Boss Dead - Reloading...');
      setTimeout(() => window.location.reload(), 1000 + Math.random() * 1000);
      return;
    }

    const now = Date.now();
    if (now - state.lastCheck < 500) return;
    state.lastCheck = now;

    // Start Raid
    if (settings.autoRaid && canClick('ok') && state.currentScreen === 'start') {
      const okButton = findQuestStartButton();
      if (okButton) {
        cooldowns.ok             = Date.now();
        state.autoCombatActive   = false;
        state.autoClickAttempted = false;

        if (Math.random() < timing.HUMAN_DELAY_CHANCE) {
          const delay = getRandomDelay(timing.HUMAN_DELAY_MIN, timing.HUMAN_DELAY_MAX);
          updateStatus(`Thinking... (+${Math.round(delay / 1000)}s)`);
          await sleep(delay);
        }

        await simulateClick(okButton, 'Starting Raid...');
        updateStatus('Raid Started - Waiting for Battle...');
        return;
      }
    }

    const inBattle = state.currentScreen === 'battle' &&
                     state.hasSeenAutoButton           &&
                     !state.autoClickAttempted         &&
                     !state.autoCombatActive;

    // Quick Attack
    if (settings.quickAttack && canClick('attack') && inBattle) {
      const attackButton = findAttackButton();
      if (attackButton) {
        cooldowns.attack         = Date.now();
        state.autoClickAttempted = true;
        await simulateClick(attackButton, 'Quick Attack');
        state.autoCombatActive = true;
        updateStatus('Quick Attack Used');
        setTimeout(() => {
          state.autoCombatActive   = false;
          state.autoClickAttempted = false;
        }, 5000);
        return;
      }
    }

    // Auto Combat
    if (settings.autoCombat && canClick('auto') && inBattle) {
      const autoButton = findAutoButton();
      if (autoButton) {
        cooldowns.auto           = Date.now();
        state.autoClickAttempted = true;
        await simulateClick(autoButton, 'Auto Combat');
        state.autoCombatActive = true;
        updateStatus('Auto Combat Enabled');
        return;
      }
    }
  }

  // ==========================================================
  // Observer & Interval
  // ==========================================================

  function startObservers() {
    const observer = new MutationObserver(() => {
      if (!state.active) return;
      detectCurrentScreen();
      checkButtons();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
      if (!state.active) return;
      detectCurrentScreen();
      checkButtons();
    }, timing.CHECK_INTERVAL);
  }

  // ==========================================================
  // Init
  // ==========================================================

  function init() {
    try {
      buildUI();
      startObservers();
      updateStatus('Ready');
      console.log('✅ Percival Mobile Loaded.');
    } catch (e) {
      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;color:white;padding:10px;z-index:2147483647;font-size:12px;word-break:break-all;';
      div.textContent = 'Percival Error: ' + e.message;
      document.body.appendChild(div);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 1000);
  }

})();