/**
 * Shop AI Chat - Client-side implementation
 *
 * This module handles the chat interface for the Shopify AI Chat application.
 * It manages the UI interactions, API communication, and message rendering.
 */
(function() {
  'use strict';

  /**
   * Add a variant to the Shopify session cart and sync the cart UI element
   * (cart-drawer or cart-notification) using its own getSectionsToRender().
   * Falls back to a redirect if no cart element is found.
   */
  async function addAndSyncCart(variantId, quantity = 1) {
    const cart = document.querySelector('cart-drawer') || document.querySelector('cart-notification');

    if (!cart) {
      console.log('[ShopAI] No cart element found — redirecting');
      window.location = '/cart/add?id=' + variantId + '&quantity=' + quantity;
      return;
    }

    const sectionsToRender = cart.getSectionsToRender();

    const body = new FormData();
    body.append('id', variantId);
    body.append('quantity', quantity);
    body.append('sections', sectionsToRender.map(s => s.id).join(','));
    body.append('sections_url', location.pathname);
    // Hidden line item property (underscore prefix = hidden from customers in UI)
    body.append('properties[_add_to_cart_source]', 'AI Chatbot');

    const res = await fetch('/cart/add.js', { method: 'POST', body });
    const data = await res.json();

    if (data.status) {
      console.error('[ShopAI] Cart add error:', data.description || data.message);
      throw new Error(data.description || data.message);
    }

    const cartWasEmpty = cart.classList.contains('is-empty');
    if (cartWasEmpty) cart.classList.remove('is-empty');

    // Update ONLY the cart icon bubble (item count badge) — do NOT call
    // renderContents here because that method opens the drawer. The drawer
    // is opened only when the customer explicitly taps "View Cart".
    const bubbleSection = data.sections && data.sections['cart-icon-bubble'];
    if (bubbleSection) {
      const bubbleEl = document.getElementById('cart-icon-bubble');
      if (bubbleEl) {
        try {
          const doc   = new DOMParser().parseFromString(bubbleSection, 'text/html');
          const inner = doc.querySelector('.shopify-section');
          if (inner) bubbleEl.innerHTML = inner.innerHTML;
        } catch (_) {}
      }
    }
  }

  // ── Preset config defaults (used before API response arrives) ──────────────
  const DEFAULT_PRESET = {
    heading: "Hey, I'm your Store Assistant",
    subtext: "Ask me anything about products, orders, or returns.",
    featureCards: [
      { icon: "🔍", title: "Find products",  desc: "Search our catalog by type, brand, or use case",  chip: "Find me some products" },
      { icon: "📦", title: "Track orders",   desc: "Real-time status for any order in your history",  chip: "Track my latest order" },
      { icon: "↩️", title: "Easy returns",   desc: "Start a return or exchange in seconds",           chip: "I'd like to start a return" },
      { icon: "🎁", title: "Gift finder",    desc: "Personalized picks for any occasion and budget",  chip: "Help me find a gift" },
    ],
    suggestionChips: [
      { text: "Popular products", chip: "Find me popular products" },
      { text: "Shipping times",   chip: "What are your shipping times?" },
      { text: "Return policy",    chip: "What is your return policy?" },
      { text: "Gift ideas",       chip: "Help me find a gift under $100" },
    ],
    quickBarChips: [
      { icon: "🔍", text: "Search",      chip: "Search products" },
      { icon: "📦", text: "Track order", chip: "Track my order" },
      { icon: "↩️", text: "Returns",     chip: "I need to return something" },
      { icon: "🏷️", text: "Deals",       chip: "Show me deals and discounts" },
      { icon: "🎁", text: "Gifts",       chip: "Help me find a gift" },
    ],
  };

  function mergePreset(p) {
    if (!p) return DEFAULT_PRESET;
    return {
      heading:         p.heading         || DEFAULT_PRESET.heading,
      subtext:         p.subtext          || DEFAULT_PRESET.subtext,
      featureCards:    (p.featureCards    || DEFAULT_PRESET.featureCards).slice(0,15),
      suggestionChips: (p.suggestionChips || DEFAULT_PRESET.suggestionChips).slice(0,15),
      quickBarChips:   (p.quickBarChips   || DEFAULT_PRESET.quickBarChips).slice(0,15),
    };
  }

  /** Build the #shop-ai-welcome element from a preset. */
  function buildWelcomeScreen(preset) {
    const p = mergePreset(preset);
    const el = document.createElement('div');
    el.id = 'shop-ai-welcome';
    el.classList.add('shop-ai-welcome');
    el.style.display = 'none';

    // Avatar
    const av = document.createElement('div');
    av.classList.add('shop-ai-welcome-avatar');
    av.textContent = '✦';

    // Title
    const h2 = document.createElement('h2');
    h2.classList.add('shop-ai-welcome-title');
    h2.textContent = p.heading;

    // Subtitle
    const sub = document.createElement('p');
    sub.classList.add('shop-ai-welcome-subtitle');
    sub.textContent = p.subtext;

    // Feature grid
    const grid = document.createElement('div');
    grid.classList.add('shop-ai-feature-grid');
    p.featureCards.forEach(function(card) {
      const c = document.createElement('div');
      c.classList.add('shop-ai-feature-card');
      c.setAttribute('data-chip', card.chip);
      const icon = document.createElement('div'); icon.classList.add('shop-ai-feature-card-icon'); icon.textContent = card.icon;
      const title = document.createElement('div'); title.classList.add('shop-ai-feature-card-title'); title.textContent = card.title;
      const desc = document.createElement('div'); desc.classList.add('shop-ai-feature-card-desc'); desc.textContent = card.desc;
      const hdr = document.createElement('div'); hdr.classList.add('shop-ai-feature-card-header');
      hdr.appendChild(icon); hdr.appendChild(title);
      c.appendChild(hdr); c.appendChild(desc);
      grid.appendChild(c);
    });

    // Suggestion chips
    const chips = document.createElement('div');
    chips.classList.add('shop-ai-suggestion-chips');
    p.suggestionChips.forEach(function(chip) {
      const btn = document.createElement('button');
      btn.classList.add('shop-ai-chip');
      btn.setAttribute('data-chip', chip.chip);
      btn.textContent = chip.text;
      chips.appendChild(btn);
    });

    el.appendChild(av); el.appendChild(h2); el.appendChild(sub);
    el.appendChild(grid); el.appendChild(chips);
    return el;
  }

  /** Build the .shop-ai-quick-bar element from a preset. */
  function buildQuickBar(preset) {
    const p = mergePreset(preset);

    // Wrapper holds the two arrows + the scrollable strip
    const wrap = document.createElement('div');
    wrap.classList.add('shop-ai-quick-bar-wrap');

    // Left arrow
    const leftArrow = document.createElement('button');
    leftArrow.classList.add('shop-ai-quick-arrow', 'shop-ai-quick-arrow-left');
    leftArrow.setAttribute('aria-label', 'Scroll left');
    leftArrow.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

    // Chips strip
    const bar = document.createElement('div');
    bar.classList.add('shop-ai-quick-bar');
    p.quickBarChips.forEach(function(chip) {
      const btn = document.createElement('button');
      btn.classList.add('shop-ai-quick-chip');
      btn.setAttribute('data-chip', chip.chip);
      const icon = document.createElement('span'); icon.classList.add('shop-ai-quick-chip-icon'); icon.textContent = chip.icon;
      btn.appendChild(icon);
      btn.appendChild(document.createTextNode('\u00a0' + chip.text));
      bar.appendChild(btn);
    });

    // Right arrow
    const rightArrow = document.createElement('button');
    rightArrow.classList.add('shop-ai-quick-arrow', 'shop-ai-quick-arrow-right');
    rightArrow.setAttribute('aria-label', 'Scroll right');
    rightArrow.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

    wrap.appendChild(leftArrow);
    wrap.appendChild(bar);
    wrap.appendChild(rightArrow);

    // Arrow visibility logic
    function syncArrows() {
      const atStart = bar.scrollLeft <= 1;
      const atEnd   = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 1;
      leftArrow.classList.toggle('shop-ai-quick-arrow-hidden', atStart);
      rightArrow.classList.toggle('shop-ai-quick-arrow-hidden', atEnd);
    }

    leftArrow.addEventListener('click',  function() { bar.scrollBy({ left: -130, behavior: 'smooth' }); });
    rightArrow.addEventListener('click', function() { bar.scrollBy({ left:  130, behavior: 'smooth' }); });
    bar.addEventListener('scroll', syncArrows);
    // Run after element is mounted so scrollWidth is available
    setTimeout(syncArrows, 60);

    return wrap;
  }

  /** Update an existing welcome screen and quick bar in-place. */
  function applyPresetToDOM(container, preset) {
    const chatWindow = container.querySelector('.shop-ai-chat-window');
    if (!chatWindow) return;

    // Replace welcome screen
    const old = container.querySelector('#shop-ai-welcome');
    const wasVisible = old && old.style.display !== 'none';
    const newWelcome = buildWelcomeScreen(preset);
    if (wasVisible) newWelcome.style.display = 'flex';
    if (old) old.replaceWith(newWelcome);
    else chatWindow.insertBefore(newWelcome, chatWindow.querySelector('.shop-ai-chat-messages'));

    // Keep the cached element reference up-to-date so showWelcome/hideWelcome
    // always operate on the live DOM node, not a detached ghost.
    if (ShopAIChat.UI && ShopAIChat.UI.elements) {
      ShopAIChat.UI.elements.welcomeScreen = newWelcome;
    }

    // Replace quick bar (wrapper takes precedence over bare bar for back-compat)
    const oldBar = container.querySelector('.shop-ai-quick-bar-wrap') || container.querySelector('.shop-ai-quick-bar');
    const newBar = buildQuickBar(preset);
    if (oldBar) oldBar.replaceWith(newBar);

    // Re-wire chip click handlers
    ShopAIChat.UI.setupEventListeners();
  }

  /** Fetch and apply preset config from the API (with localStorage cache). */
  async function fetchAndApplyPreset(container) {
    const shop   = window.shopDomain;
    const appUrl = window.shopChatConfig?.appUrl;
    if (!shop || !appUrl) return;

    const cacheKey = 'shopAiPreset_' + shop;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try { applyPresetToDOM(container, JSON.parse(cached)); } catch {}
    }

    try {
      const res = await fetch(`${appUrl}/api/widget-config?shop=${encodeURIComponent(shop)}`);
      if (!res.ok) return;
      const data = await res.json();
      localStorage.setItem(cacheKey, JSON.stringify(data));
      applyPresetToDOM(container, data);
    } catch {}
  }

  /**
   * Application namespace to prevent global scope pollution
   */
  const ShopAIChat = {
    /** Currently pinned product used as conversation context (null = none) */
    pinnedProduct: null,

    /**
     * Trigger a mild haptic pulse when the AI starts responding.
     * - Android / modern browsers: uses the Vibration API.
     * - iOS Safari 17.4+ / PWA mode: Vibration API is now supported.
     * - Older iOS / unsupported browsers: silent AudioContext tick as a
     *   best-effort fallback (may trigger Taptic Engine on some devices).
     */
    hapticFeedback: function() {
      // Only fire on touch/mobile devices
      if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;
      // Vibration API — Android, Firefox mobile, iOS 17.4+ PWA
      if (typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(30); return; } catch (_) {}
      }
      // iOS fallback: near-silent AudioContext click — may engage Taptic Engine
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.03, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start();
        src.onended = function() { ctx.close(); };
      } catch (_) {}
    },
    UI: {
      elements: {},
      isMobile: false,
      autoScroll: true,   // true = follow streaming; set to false when user scrolls up

      /**
       * Initialize UI elements and event listeners
       * @param {HTMLElement} container - The main container element
       */
      init: function(container) {
        if (!container) return;

        // Guard: prevent duplicate initialisation
        if (container.dataset.shopAiReady) return;
        container.dataset.shopAiReady = 'true';

        const chatWindow = container.querySelector('.shop-ai-chat-window');
        const messagesEl = container.querySelector('.shop-ai-chat-messages');
        const inputEl    = container.querySelector('.shop-ai-chat-input');

        // ── Inject welcome screen ──────────────────────────────────────────
        if (chatWindow && messagesEl && !container.querySelector('#shop-ai-welcome')) {
          const welcome = buildWelcomeScreen(null); // defaults; API call updates it
          chatWindow.insertBefore(welcome, messagesEl);
        }

        // ── Inject quick bar ───────────────────────────────────────────────
        if (chatWindow && inputEl && !container.querySelector('.shop-ai-quick-bar-wrap')) {
          const quickBar = buildQuickBar(null);
          chatWindow.insertBefore(quickBar, inputEl);
        }

        // Cache DOM elements
        this.elements = {
          container: container,
          chatBubble: container.querySelector('.shop-ai-chat-bubble'),
          chatWindow: container.querySelector('.shop-ai-chat-window'),
          closeButton: container.querySelector('.shop-ai-chat-close'),
          newChatButton: container.querySelector('.shop-ai-new-chat'),
          chatInput: container.querySelector('.shop-ai-chat-input input'),
          sendButton: container.querySelector('.shop-ai-chat-send'),
          messagesContainer: container.querySelector('#shop-ai-messages') || container.querySelector('.shop-ai-chat-messages'),
          welcomeScreen: container.querySelector('#shop-ai-welcome')
        };

        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // ── Pinned product banner ───────────────────────────────────────
        // Created dynamically and inserted between the header and messages area
        const pinnedBanner = document.createElement('div');
        pinnedBanner.classList.add('shop-ai-pinned-banner');
        pinnedBanner.setAttribute('aria-live', 'polite');
        pinnedBanner.innerHTML =
          '<div class="shop-ai-pinned-inner">' +
            '<svg class="shop-ai-pinned-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>' +
            '<img class="shop-ai-pinned-thumb" alt="" />' +
            '<div class="shop-ai-pinned-info">' +
              '<span class="shop-ai-pinned-label">Selected product</span>' +
              '<span class="shop-ai-pinned-name"></span>' +
            '</div>' +
            '<button class="shop-ai-pinned-remove" aria-label="Remove product context">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
          '</div>';

        const chatHeader = container.querySelector('.shop-ai-chat-header');
        if (chatHeader) {
          chatHeader.insertAdjacentElement('afterend', pinnedBanner);
        } else {
          this.elements.chatWindow.prepend(pinnedBanner);
        }
        pinnedBanner.querySelector('.shop-ai-pinned-remove').addEventListener('click', function() {
          ShopAIChat.UI.unpinProduct();
        });
        this.elements.pinnedBanner = pinnedBanner;
        // ──────────────────────────────────────────────────────────────

        // Smart-follow scroll: detect when the user manually scrolls away
        // from the bottom so we stop auto-following the stream.
        const _mc = this.elements.messagesContainer;
        if (_mc) {
          _mc.addEventListener('scroll', function() {
            const nearBottom = _mc.scrollHeight - _mc.scrollTop - _mc.clientHeight < 80;
            ShopAIChat.UI.autoScroll = nearBottom;
          }, { passive: true });
        }

        this.setupEventListeners();

        if (this.isMobile) {
          this.setupMobileViewport();
        }

        // Fetch & apply preset config asynchronously (updates welcome screen + quick bar)
        fetchAndApplyPreset(container);
      },

      /**
       * Set up all event listeners for UI interactions
       */
      setupEventListeners: function() {
        const { chatBubble, closeButton, chatInput, sendButton, messagesContainer } = this.elements;
        const container = this.elements.container;
        const themeToggle = container.querySelector('.shop-ai-theme-toggle');

        // Dark theme by default (matches Figma)
        const savedTheme = localStorage.getItem('shopAiChatTheme') || 'dark';
        this.applyTheme(savedTheme);

        chatBubble.addEventListener('click', () => this.toggleChatWindow());
        closeButton.addEventListener('click', () => this.closeChatWindow());

        // New conversation button
        const { newChatButton } = this.elements;
        if (newChatButton) {
          newChatButton.addEventListener('click', () => {
            // Clear conversation state
            sessionStorage.removeItem('shopAiConversationId');
            window.shopAuthUrl = null;
            // Reset pinned product
            ShopAIChat.UI.unpinProduct();
            // Clear messages
            const { messagesContainer } = this.elements;
            if (messagesContainer) messagesContainer.innerHTML = '';
            // Return to welcome screen
            this.showWelcome();
          });
        }

        // Theme toggle
        if (themeToggle) {
          themeToggle.addEventListener('click', () => {
            const isLight = container.getAttribute('data-chat-theme') === 'light';
            const next = isLight ? 'dark' : 'light';
            this.applyTheme(next);
            localStorage.setItem('shopAiChatTheme', next);
          });
        }

        // Welcome screen feature card clicks
        const welcome = this.elements.welcomeScreen;
        if (welcome) {
          welcome.querySelectorAll('[data-chip]').forEach((el) => {
            el.addEventListener('click', () => {
              const chip = el.getAttribute('data-chip');
              if (chip) {
                chatInput.value = chip;
                ShopAIChat.Message.send(chatInput, messagesContainer);
              }
            });
          });
        }

        // Quick bar chips only — suggestion chips inside the welcome screen are
        // already handled by the [data-chip] listener above and must not get
        // a second listener here (that would send the message twice).
        container.querySelectorAll('.shop-ai-quick-chip').forEach((btn) => {
          btn.addEventListener('click', () => {
            const chip = btn.getAttribute('data-chip') || btn.textContent.trim();
            if (chip) {
              chatInput.value = chip;
              ShopAIChat.Message.send(chatInput, messagesContainer);
            }
          });
        });

        chatInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && chatInput.value.trim() !== '') {
            ShopAIChat.Message.send(chatInput, messagesContainer);
            if (this.isMobile) {
              chatInput.blur();
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });

        sendButton.addEventListener('click', () => {
          if (chatInput.value.trim() !== '') {
            ShopAIChat.Message.send(chatInput, messagesContainer);
            if (this.isMobile) setTimeout(() => chatInput.focus(), 300);
          }
        });

        window.addEventListener('resize', () => this.scrollToBottom());

        document.addEventListener('click', function(event) {
          if (event.target && event.target.classList.contains('shop-auth-trigger')) {
            event.preventDefault();
            if (window.shopAuthUrl) ShopAIChat.Auth.openAuthPopup(window.shopAuthUrl);
          }
        });
      },

      applyTheme: function(theme) {
        const container = this.elements.container;
        const sunIcon  = container.querySelector('.icon-sun');
        const moonIcon = container.querySelector('.icon-moon');
        if (theme === 'light') {
          container.setAttribute('data-chat-theme', 'light');
          if (sunIcon)  sunIcon.style.display  = 'none';
          if (moonIcon) moonIcon.style.display = '';
        } else {
          container.removeAttribute('data-chat-theme');
          if (sunIcon)  sunIcon.style.display  = '';
          if (moonIcon) moonIcon.style.display = 'none';
        }
      },

      showWelcome: function() {
        const { welcomeScreen, messagesContainer, newChatButton } = this.elements;
        if (welcomeScreen) welcomeScreen.style.display = 'flex';
        if (messagesContainer) messagesContainer.style.display = 'none';
        if (newChatButton) newChatButton.style.display = 'none';
      },

      hideWelcome: function() {
        const { welcomeScreen, messagesContainer, newChatButton } = this.elements;
        if (welcomeScreen) welcomeScreen.style.display = 'none';
        if (messagesContainer) messagesContainer.style.display = 'flex';
        if (newChatButton) newChatButton.style.display = 'flex';
      },

      /**
       * Pin a product as the active conversation context.
       * Shows the sticky banner and marks the card's pin button active.
       */
      pinProduct: function(product) {
        ShopAIChat.pinnedProduct = product;
        // Persist so the pinned state (and its formatting) survives a page reload.
        try { sessionStorage.setItem('shopAiPinnedProduct', JSON.stringify(product)); } catch(_) {}
        const banner = this.elements.pinnedBanner;
        if (!banner) return;

        const thumb = banner.querySelector('.shop-ai-pinned-thumb');
        const name  = banner.querySelector('.shop-ai-pinned-name');

        const imgUrl = product.image_url || product.imageUrl ||
          (product.featuredImage && product.featuredImage.url) || '';
        if (thumb) {
          if (imgUrl) { thumb.src = imgUrl; thumb.style.display = ''; }
          else        { thumb.style.display = 'none'; }
        }
        if (name) name.textContent = product.title || '';

        banner.classList.add('shop-ai-pinned-show');

        // Update pin button active states across all visible cards
        const productId = String(product.id || product.handle || '');
        document.querySelectorAll('.shop-ai-product-pin-btn').forEach(function(btn) {
          if (btn.dataset.productId === productId) {
            btn.classList.add('active');
            btn.title = 'Pinned — questions will reference this product';
          } else {
            btn.classList.remove('active');
            btn.title = 'Pin for context';
          }
        });
      },

      /**
       * Clear the pinned product and hide the banner.
       */
      unpinProduct: function() {
        ShopAIChat.pinnedProduct = null;
        sessionStorage.removeItem('shopAiPinnedProduct');
        const banner = this.elements.pinnedBanner;
        if (banner) banner.classList.remove('shop-ai-pinned-show');
        document.querySelectorAll('.shop-ai-product-pin-btn').forEach(function(btn) {
          btn.classList.remove('active');
          btn.title = 'Pin for context';
        });
      },

      /**
       * Setup mobile-specific viewport adjustments
       */
      setupMobileViewport: function() {
        const setViewportHeight = () => {
          document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
        };
        window.addEventListener('resize', setViewportHeight);
        setViewportHeight();
      },

      /**
       * Toggle chat window visibility
       */
      toggleChatWindow: function() {
        const { chatWindow, chatInput } = this.elements;

        chatWindow.classList.toggle('active');

        if (chatWindow.classList.contains('active')) {
          // On mobile, prevent body scrolling and delay focus
          if (this.isMobile) {
            document.body.classList.add('shop-ai-chat-open');
            setTimeout(() => chatInput.focus(), 500);
          } else {
            chatInput.focus();
          }
          // Always scroll messages to bottom when opening
          this.scrollToBottom();
        } else {
          // Remove body class when closing
          document.body.classList.remove('shop-ai-chat-open');
        }
      },

      /**
       * Close chat window
       */
      closeChatWindow: function() {
        const { chatWindow, chatInput } = this.elements;

        chatWindow.classList.remove('active');

        // On mobile, blur input to hide keyboard and enable body scrolling
        if (this.isMobile) {
          chatInput.blur();
          document.body.classList.remove('shop-ai-chat-open');
        }
      },

      /**
       * Scroll messages container to bottom
       */
      scrollToBottom: function() {
        this.autoScroll = true;   // re-engage follow mode whenever we scroll to bottom explicitly
        const { messagesContainer } = this.elements;
        setTimeout(() => {
          messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
        }, 100);
      },

      /**
       * Instantly snap to the bottom only when in follow mode.
       * Called on every streaming chunk — has no effect if the user has scrolled up.
       */
      scrollToFollowBottom: function() {
        if (!this.autoScroll) return;
        const { messagesContainer } = this.elements;
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
      },

      /**
       * Scroll so the TOP of el sits near the top of the messages pane.
       * Accounts for the pinned-product banner (if visible) because it is
       * outside the messages container in the flex layout and pushes the
       * container’s bounding rect down — getBoundingClientRect already
       * reflects that shift, so no manual offset is needed. We use a
       * direct scrollTop assignment (no animation) to prevent later scroll
       * calls from cancelling a smooth animation mid-way.
       */
      scrollToElement: function(el) {
        const { messagesContainer } = this.elements;
        setTimeout(() => {
          const cRect = messagesContainer.getBoundingClientRect();
          const eRect = el.getBoundingClientRect();
          // Absolute position of el within the scroll content.
          const absoluteTop = eRect.top - cRect.top + messagesContainer.scrollTop;
          // 8 px breathing room so the element isn't flush with the top edge.
          messagesContainer.scrollTop = Math.max(0, absoluteTop - 8);
        }, 80);
      },

      /**
       * Show typing indicator in the chat
       */
      showTypingIndicator: function() {
        const { messagesContainer } = this.elements;

        // Remove any existing indicator first so we never show more than one.
        messagesContainer.querySelectorAll('.shop-ai-typing-indicator').forEach(function(el) {
          el.remove();
        });

        const row = document.createElement('div');
        row.classList.add('shop-ai-typing-indicator');

        const avatar = document.createElement('div');
        avatar.classList.add('shop-ai-bot-avatar-sm');
        avatar.textContent = '✦';

        const dots = document.createElement('div');
        dots.classList.add('shop-ai-typing-dots');
        dots.innerHTML = '<span></span><span></span><span></span>';

        row.appendChild(avatar);
        row.appendChild(dots);
        messagesContainer.appendChild(row);
        this.scrollToBottom();
      },

      /**
       * Remove typing indicator from the chat
       */
      removeTypingIndicator: function() {
        const { messagesContainer } = this.elements;

        messagesContainer.querySelectorAll('.shop-ai-typing-indicator').forEach(function(el) {
          el.remove();
        });
      },

      /**
       * Display product results in the chat
       * @param {Array} products - Array of product data objects
       */
      displayProductResults: function(products) {
        // Cache for URL lookups by decorateProductEntries
        ShopAIChat._lastProductResults = (ShopAIChat._lastProductResults || []).concat(products || []);

        const { messagesContainer } = this.elements;

        // Sort cards to match the order products appear in the preceding bot message.
        // The AI may list products in alphabetical or relevance order that differs
        // from the GID-fetch order used to build `products`.
        const sortedProducts = (function(prods) {
          // Find the last rendered bot message element
          const botRows = messagesContainer.querySelectorAll('.shop-ai-bot-row');
          if (!botRows.length) return prods;
          const lastMsg = botRows[botRows.length - 1].querySelector('.shop-ai-message.assistant');
          if (!lastMsg) return prods;

          const msgText = lastMsg.textContent.toLowerCase();

          // Map each product to its first mention position in the message
          const withPos = prods.map(function(p) {
            const title = (p.title || '').toLowerCase().trim();
            return { product: p, pos: title ? msgText.indexOf(title) : -1 };
          });

          // Sort by appearance order; unmentioned products stay at the end
          withPos.sort(function(a, b) {
            if (a.pos === -1 && b.pos === -1) return 0;
            if (a.pos === -1) return 1;
            if (b.pos === -1) return -1;
            return a.pos - b.pos;
          });

          return withPos.map(function(item) { return item.product; });
        })(products || []);

        // Create a wrapper for the product section
        const productSection = document.createElement('div');
        productSection.classList.add('shop-ai-product-section');
        messagesContainer.appendChild(productSection);

        // Add a header for the product results
        const header = document.createElement('div');
        header.classList.add('shop-ai-product-header');
        header.innerHTML = '<h4>Top Matching Products</h4>';
        productSection.appendChild(header);

        // Create the product grid container
        const productsContainer = document.createElement('div');
        productsContainer.classList.add('shop-ai-product-grid');
        productSection.appendChild(productsContainer);

        // ── Mouse-drag (click-and-drag) free scrolling ────────────────
        // Lets desktop users drag the card row with the mouse naturally,
        // without snapping or inertia interference.
        (function attachDragScroll(el) {
          let isDown = false, startX = 0, scrollLeft = 0;
          el.addEventListener('mousedown', function(e) {
            isDown   = true;
            startX   = e.pageX - el.offsetLeft;
            scrollLeft = el.scrollLeft;
            el.style.cursor = 'grabbing';
            el.style.scrollBehavior = 'auto';
          });
          el.addEventListener('mouseleave', function() {
            isDown = false;
            el.style.cursor = 'grab';
          });
          el.addEventListener('mouseup', function() {
            isDown = false;
            el.style.cursor = 'grab';
          });
          el.addEventListener('mousemove', function(e) {
            if (!isDown) return;
            e.preventDefault();
            const x    = e.pageX - el.offsetLeft;
            const walk = (x - startX) * 1.2; // speed multiplier
            el.scrollLeft = scrollLeft - walk;
          });
        })(productsContainer);

        // Redirect vertical wheel scroll to horizontal on mouse/trackpad devices only.
        // (hover:hover) and (pointer:fine) reliably excludes touch screens.
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
          let _wheelDelta = 0;
          let _wheelPending = false;
          productsContainer.addEventListener('wheel', function(e) {
            if (e.deltaY !== 0) {
              e.preventDefault();
              _wheelDelta += e.deltaY * 1.2;
              if (!_wheelPending) {
                _wheelPending = true;
                requestAnimationFrame(function() {
                  productsContainer.scrollBy({ left: _wheelDelta, behavior: 'smooth' });
                  _wheelDelta   = 0;
                  _wheelPending = false;
                });
              }
            }
          }, { passive: false });
        }

        if (!sortedProducts.length) {
          const noProductsMessage = document.createElement('p');
          noProductsMessage.textContent = "No products found";
          noProductsMessage.style.padding = "10px";
          productsContainer.appendChild(noProductsMessage);
        } else {
          sortedProducts.forEach(product => {
            const productCard = ShopAIChat.Product.createCard(product);
            productsContainer.appendChild(productCard);
          });
        }

        // No scroll after product cards — view stays at the top of the response
        // text so the user can read it before scrolling down to the cards.
      }
    },

    /**
     * Message handling and display functionality
     */
    Message: {
      /**
       * Send a message to the API
       * @param {HTMLInputElement} chatInput - The input element
       * @param {HTMLElement} messagesContainer - The messages container
       */
      send: async function(chatInput, messagesContainer) {
        const userMessage = chatInput.value.trim();
        const conversationId = sessionStorage.getItem('shopAiConversationId');

        // If a product is pinned, prepend its context to the API message so the
        // AI knows which product the user is referring to. The chat bubble always
        // shows only the user’s original words.
        let apiMessage = userMessage;
        if (ShopAIChat.pinnedProduct) {
          const p = ShopAIChat.pinnedProduct;
          const handle = p.handle || '';
          const ctx =
            '[PINNED_PRODUCT_CONTEXT]\n' +
            'The customer has pinned ONE specific product. Answer ONLY about this product:\n' +
            '  Title:  "' + (p.title || '') + '"\n' +
            (p.brand  ? '  Brand:  ' + p.brand  + '\n' : '') +
            (handle   ? '  Handle: ' + handle   + '\n' : '') +
            (p.id     ? '  GID:    ' + p.id     + '\n' : '') +
            'STRICT RULES — no exceptions:\n' +
            '1. Call get_product with EXACTLY: ' +
              (p.id ? '{ "productId": "' + p.id + '" }' : '{ "handle": "' + handle + '" }') + '\n' +
            '   Fallback if get_product fails: use lookup_catalog with { "handle": "' + handle + '" }\n' +
            '2. NEVER call search_catalog, search_store_faqs, or search_shop_policies_and_faqs — those ignore the pinned product.\n' +
            '3. If any tool returns multiple products, keep ONLY the one with handle "' + handle + '".\n' +
            '4. Do NOT mention, compare, or reference any other product.\n' +
            '5. Ignore all products discussed in earlier conversation turns.\n' +
            '[/PINNED_PRODUCT_CONTEXT]';
          apiMessage = ctx + '\n\n' + userMessage;
        }

        // Show messages pane on first send
        ShopAIChat.UI.hideWelcome();

        this.add(userMessage, 'user', messagesContainer);
        chatInput.value = '';

        ShopAIChat.UI.showTypingIndicator();

        try {
          ShopAIChat.API.streamResponse(apiMessage, conversationId, messagesContainer);
        } catch (error) {
          console.error('Error communicating with Claude API:', error);
          ShopAIChat.UI.removeTypingIndicator();
          this.add("Sorry, I couldn't process your request at the moment. Please try again later.", 'assistant', messagesContainer);
        }
      },

      /**
       * Add a message to the chat
       * @param {string} text - Message content
       * @param {string} sender - Message sender ('user' or 'assistant')
       * @param {HTMLElement} messagesContainer - The messages container
       * @returns {HTMLElement} The created message element
       */
      add: function(text, sender, messagesContainer) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('shop-ai-message', sender);

        if (sender === 'assistant') {
          messageElement.dataset.rawText = text;
          ShopAIChat.Formatting.formatMessageContent(messageElement);

          // Wrap in row with avatar (Figma design)
          const row = document.createElement('div');
          row.classList.add('shop-ai-bot-row');

          const avatar = document.createElement('div');
          avatar.classList.add('shop-ai-bot-avatar-sm');
          avatar.textContent = '\u2726';

          row.appendChild(avatar);
          row.appendChild(messageElement);
          messagesContainer.appendChild(row);

          // Detect collection / blog-post links and render cards — always,
          // so history reload and live streaming look identical.
          ShopAIChat.Cards.detectAndRender(messageElement, messagesContainer);
        } else {
          messageElement.textContent = text;
          messagesContainer.appendChild(messageElement);
        }

        ShopAIChat.UI.scrollToBottom();
        return messageElement;
      },

      /**
       * Add a tool use message to the chat with expandable arguments
       * @param {string} toolMessage - Tool use message content
       * @param {HTMLElement} messagesContainer - The messages container
       */
      addToolUse: function(toolMessage, messagesContainer) {
        // Parse the tool message to extract tool name and arguments
        const match = toolMessage.match(/Calling tool: (\w+) with arguments: (.+)/);
        if (!match) {
          // Fallback for unexpected format
          const toolUseElement = document.createElement('div');
          toolUseElement.classList.add('shop-ai-message', 'tool-use');
          toolUseElement.textContent = toolMessage;
          messagesContainer.appendChild(toolUseElement);
          ShopAIChat.UI.scrollToBottom();
          return;
        }

        const toolName = match[1];
        const argsString = match[2];

        // Create the main tool use element
        const toolUseElement = document.createElement('div');
        toolUseElement.classList.add('shop-ai-message', 'tool-use');

        // Create the header (always visible)
        const headerElement = document.createElement('div');
        headerElement.classList.add('shop-ai-tool-header');

        const toolText = document.createElement('span');
        toolText.classList.add('shop-ai-tool-text');
        toolText.textContent = `Calling tool: ${toolName}`;

        const toggleElement = document.createElement('span');
        toggleElement.classList.add('shop-ai-tool-toggle');
        toggleElement.textContent = '[+]';

        headerElement.appendChild(toolText);
        headerElement.appendChild(toggleElement);

        // Create the arguments section (initially hidden)
        const argsElement = document.createElement('div');
        argsElement.classList.add('shop-ai-tool-args');

        try {
          // Try to format JSON arguments nicely
          const parsedArgs = JSON.parse(argsString);
          argsElement.textContent = JSON.stringify(parsedArgs, null, 2);
        } catch (e) {
          // If not valid JSON, just show as-is
          argsElement.textContent = argsString;
        }

        // Add click handler to toggle arguments visibility
        headerElement.addEventListener('click', function() {
          const isExpanded = argsElement.classList.contains('expanded');
          if (isExpanded) {
            argsElement.classList.remove('expanded');
            toggleElement.textContent = '[+]';
          } else {
            argsElement.classList.add('expanded');
            toggleElement.textContent = '[-]';
          }
        });

        // Assemble the complete element
        toolUseElement.appendChild(headerElement);
        toolUseElement.appendChild(argsElement);

        messagesContainer.appendChild(toolUseElement);
        ShopAIChat.UI.scrollToBottom();
      }
    },

    /**
     * Text formatting and markdown handling
     */
    Formatting: {
      /**
       * Return contextual heading text near a list item (same message bubble).
       * Scans several preceding siblings so split lists rendered during streaming
       * can still inherit context like "Available Colors".
       */
      getNearbyHeadingText: function(li) {
        if (!li) return '';
        var node = li.closest('ul, ol');
        if (!node) return '';

        var seen = 0;
        var prev = node.previousElementSibling;
        while (prev && seen < 6) {
          seen += 1;
          var txt = (prev.textContent || '').trim();
          if (txt) {
            var lower = txt.toLowerCase();
            // Positive section heading near this list.
            if (/(available|choose|select|pick).*(color|colour|variant|size|style|finish|pattern|option)|\b(color|colour|variant|size|style|finish|pattern|option)s?\b/.test(lower)) {
              return lower;
            }
            // Stop context bleed at a likely product entry boundary.
            if (/(\$\s*\d|\d[\.,]\d{2}|starting\s+at|^\w.*\s[-–—]\s)/.test(lower)) {
              return '';
            }
            // Stop at non-heading content so an old heading doesn't leak forward.
            if (seen >= 2) return '';
          }
          prev = prev.previousElementSibling;
        }
        return '';
      },

      /**
       * Heuristic guard: only treat list items as option cards when they look
       * like linkable product entities (color, variant, size, finish, etc).
       */
      isLinkableProductEntity: function(li, optionText) {
        if (!li || !optionText) return false;

        var text = optionText.toLowerCase().trim();
        var headingText = this.getNearbyHeadingText(li);
        var firstEl = li.firstElementChild;
        var isStrongLabel = !!(firstEl && (firstEl.tagName === 'STRONG' || firstEl.tagName === 'A'));

        // Explicitly exclude descriptive/spec sections.
        var negativeHeading = /(overview|product overview|benefit|benefits|description|details|detail|spec|specs|specification|specifications|feature|features|about|info|information|material|price|pricing|care|warranty|installation|thickness|wear layer|construction|performance|brand|type)/;
        if (negativeHeading.test(headingText)) return false;

        // Prefer sections that clearly imply selectable entities.
        var positiveHeading = /(color|colors|colour|colours|shade|shades|tone|tones|swatch|swatches|variant|variants|size|sizes|style|styles|finish|finishes|pattern|patterns|option|options|collection|collections|product|products|budget|premium|popular|recommended|top|best)/;
        var headingSuggestsEntity = positiveHeading.test(headingText);

        var positiveLabel = /^(color|colors|colour|colours|shade|shades|tone|tones|swatch|swatches|variant|variants|size|sizes|style|styles|finish|finishes|pattern|patterns|option|options)$/;
        var negativeLabel = /^(type|brand|description|details|detail|spec|specs|specification|specifications|feature|features|material|price|pricing|warranty|care|installation|construction|performance|benefit|benefits|overview)$/;

        // Key-value lines that start with a bold label should link when
        // the label itself is clearly an entity selector (e.g. Color, Size)
        // OR when the nearby heading indicates these are selectable options
        // (e.g. "Available Colors:" → "Beech Tree — Warm, light natural wood tone").
        if (isStrongLabel) {
          if (negativeLabel.test(text)) return false;
          if (positiveLabel.test(text)) return true;
          // Bold title followed by dash separator is a product entry pattern
          var liText = (li.textContent || '').trim();
          if (/\s+[-\u2013\u2014]\s+/.test(liText)) return true;
          return headingSuggestsEntity;
        }

        // Exclude long/sentence-like content and obvious price-ish lines.
        var words = text.split(/\s+/).filter(Boolean);
        var hasSentencePunctuation = /[.!?]$/.test(text);
        var hasPricingSignals = /[$€£¥]|\b\d+[\.,]\d{2}\b|\b\d+\s*(usd|cad|eur|gbp|aud|inr)\b|\bper\s+sample\b/.test(text);
        var hasDescriptiveTerms = /(durability|performance|protection|waterproof|resistance|resistant|scratch|stain|thickness|mm|mil|layer|core|underlayment|installation|lifetime|commercial|residential|guarantee|warranty|sample|available|includes|including)/.test(text);

        if (hasSentencePunctuation || hasPricingSignals || hasDescriptiveTerms) return false;
        if (words.length > 7 || text.length > 56) return false;

        // For plain text bullet values, require entity-focused heading context.
        return headingSuggestsEntity;
      },

      /**
       * Decorate product-entry title lines in plain assistant text:
       * - wrap each detected product entry in a card shell (consistent with option cards)
       * - make product titles clickable hyperlinks to the product detail page
       */
      decorateProductEntries: function(element) {
        if (!element) return;

        var self = this;
        var titleParas = [];
        var paras = element.querySelectorAll('p');

        paras.forEach(function(p) {
          var strong = p.querySelector('strong');
          if (!strong) return;

          var titleText = (strong.textContent || '').trim();
          if (!titleText) return;

          // The bold text must look like a product/collection NAME:
          // - Short (max 4 words / 40 chars)
          // - Not a full sentence or descriptive phrase
          // - Must be the FIRST element in the paragraph (the entry title)
          var titleWords = titleText.split(/\s+/).filter(Boolean);
          if (titleWords.length > 4 || titleText.length > 40) return;
          if (strong !== p.firstElementChild && strong !== p.firstChild) return;
          // Skip if the bold text contains numbers/prices (e.g. "**$3.00**")
          if (/^\d|^\$/.test(titleText)) return;
          // Skip common non-name patterns
          if (/^(here|perfect|great|all|the|this|these|those|our|your|we|it|they)\b/i.test(titleText)) return;

          var lineText = (p.textContent || '').trim();
          var lineTextLower = lineText.toLowerCase();

          // Product entry: bold title followed by dash/em-dash separator
          var hasDashSeparator = /\s+[-\u2013\u2014]\s+/.test(lineText);

          if (!hasDashSeparator) return;
          titleParas.push(p);

          // Convert the title text into a real hyperlink when not already linked.
          if (!strong.querySelector('a')) {
            // Use the actual product URL from cached product results data
            var href = self._findProductUrl(titleText);
            if (href) {
              href = ShopAIChat.UTM.addToUrl(href, 'inline_product_title');

              var a = document.createElement('a');
              a.className = 'shop-ai-inline-product-link';
              a.href = href;
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
              a.textContent = titleText;

              strong.textContent = '';
              strong.appendChild(a);
            }
          }
        });

        // Wrap each detected product entry paragraph in a card shell for
        // consistent appearance with option-card list items.
        titleParas.forEach(function(p) {
          // Skip if already wrapped
          if (p.parentNode && p.parentNode.classList &&
              p.parentNode.classList.contains('shop-ai-product-entry-card')) return;

          var card = document.createElement('div');
          card.classList.add('shop-ai-product-entry-card');

          // Collect the product paragraph and any following description siblings
          // that belong to this entry (stop at the next bold-title paragraph or heading)
          var siblings = [p];
          var next = p.nextElementSibling;
          while (next) {
            // Stop at the next product entry or heading
            if (next.querySelector && next.querySelector('strong')) break;
            if (next.tagName && /^H[1-6]$/.test(next.tagName)) break;
            // Stop at blank line breaks between entries
            if (next.tagName === 'BR') break;
            siblings.push(next);
            next = next.nextElementSibling;
          }

          // Insert the card before the first sibling
          p.parentNode.insertBefore(card, p);
          siblings.forEach(function(sib) { card.appendChild(sib); });

          // Add action link if product URL is available
          var titleText = (p.querySelector('strong') || {}).textContent || '';
          // If the strong contains an anchor, get text from there
          var anchor = p.querySelector('.shop-ai-inline-product-link');
          if (anchor) titleText = anchor.textContent || '';

          var itemUrl = self._findProductUrl(titleText);
          if (itemUrl) {
            var linkBtn = document.createElement('a');
            linkBtn.classList.add('shop-ai-option-link');
            linkBtn.href = ShopAIChat.UTM.addToUrl(itemUrl, 'product_entry_card');
            linkBtn.target = '_blank';
            linkBtn.rel = 'noopener noreferrer';
            linkBtn.title = 'View ' + titleText;
            linkBtn.setAttribute('aria-label', 'Open product page for ' + titleText);
            linkBtn.innerHTML =
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
              '<polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/>' +
              '</svg>';
            card.appendChild(linkBtn);
          }
        });
      },

      /**
       * Find a product URL by matching title text against rendered product cards
       * or the last product_results data.
       */
      _findProductUrl: function(titleText) {
        if (!titleText) return '';
        var needle = titleText.toLowerCase().trim();

        // Check the product results cache (populated by displayProductResults)
        var products = ShopAIChat._lastProductResults || [];
        for (var i = 0; i < products.length; i++) {
          var p = products[i];
          var pTitle = (p.title || '').toLowerCase().trim();
          if (pTitle === needle || pTitle.includes(needle) || needle.includes(pTitle)) {
            return p.url || ('/products/' + (p.handle || ''));
          }
        }
        return '';
      },

      /**
       * Format message content with markdown and links
       * @param {HTMLElement} element - The element to format
       * @param {Object} [options] - Formatting options
       * @param {boolean} [options.extractChips=true] - Whether to extract [QUICK_REPLIES] blocks
       */
      formatMessageContent: function(element, options) {
        if (!element || !element.dataset.rawText) return { chips: [] };

        let rawText = element.dataset.rawText;
        const extractChips = options?.extractChips !== false;

        // Extract [QUICK_REPLIES: "opt1", "opt2"] before HTML processing
        const chips = [];
        if (extractChips) {
          const chipsBlockRegex = /\[QUICK_REPLIES:\s*(.*?)\]\s*$/s;
          const chipsMatch = rawText.match(chipsBlockRegex);
          if (chipsMatch) {
            const inner = chipsMatch[1];
            const chipItemRegex = /"([^"]+)"/g;
            let m;
            while ((m = chipItemRegex.exec(inner)) !== null) {
              chips.push(m[1]);
            }
            // Remove the block from displayed text
            rawText = rawText.replace(chipsBlockRegex, '').trimEnd();
            element.dataset.rawText = rawText;
          }
        }

        // Escape HTML first to prevent XSS from AI-generated content
        let processedText = rawText
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        // Process Markdown links (safe: we generate the HTML ourselves)
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        processedText = processedText.replace(markdownLinkRegex, (match, text, url) => {
          const cleanUrl = url
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');

          // Don't linkify CDN image URLs — the AI sometimes mistakenly uses
          // image_url as the product link; strip the link and show plain text.
          const isImageCdn = /cdn\.shopify\.com|shopifycdn\.com|shopify\.io/.test(cleanUrl) ||
                             /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?[^)]*)?$/.test(cleanUrl);
          if (isImageCdn) {
            return text; // plain text, no anchor
          }

          if (cleanUrl.includes('shopify.com/authentication') &&
             (cleanUrl.includes('oauth/authorize') || cleanUrl.includes('authentication'))) {
            window.shopAuthUrl = cleanUrl;
            return '<a href="#auth" class="shop-auth-trigger">' + text + '</a>';
          }
          if (cleanUrl.includes('/cart') || cleanUrl.includes('checkout')) {
            // Do not render checkout or cart links — theme UI checks and
            // restrictions apply at checkout that aren't present in the chat.
            // Strip the link and show plain text instead.
            return text;
          }
          const utmUrl = ShopAIChat.UTM.addToUrl(cleanUrl, 'inline_link');
          return '<a href="' + utmUrl + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
        });

        // Convert text to HTML with proper list handling
        processedText = this.convertMarkdownToHtml(processedText);

        // Apply the formatted HTML
        element.innerHTML = processedText;

        // ── Option list cards ──────────────────────────────────────────────
        // Only style list items as option cards when they look like linkable
        // product entities (e.g. colors/variants/sizes), not descriptions/specs.
        element.querySelectorAll('li').forEach(function(li) {
            // Skip if already processed
            if (li.querySelector('.shop-ai-option-link')) return;

            // Skip question items — they are clarifying questions, not product options
            if (li.textContent.trim().endsWith('?')) return;

            const firstEl = li.firstElementChild;
            let optionText;

            if (firstEl && firstEl.tagName === 'STRONG') {
              // Bold option name candidate (may contain a nested link)
              optionText = firstEl.textContent.trim().replace(/:+$/, '');
            } else if (firstEl && firstEl.tagName === 'A') {
              // Linked option name candidate (AI used markdown link instead of bold)
              optionText = firstEl.textContent.trim().replace(/:+$/, '');
            } else if (!firstEl && li.textContent.trim()) {
              // Plain text option candidate
              optionText = li.textContent.trim().replace(/:+$/, '');
            } else {
              return; // li has other child elements (not an option item)
            }

            if (!optionText) return;
            if (!ShopAIChat.Formatting.isLinkableProductEntity(li, optionText)) {
              li.classList.remove('shop-ai-option-card');
              return;
            }

            li.classList.add('shop-ai-option-card');
            var parentUl = li.closest('ul');
            if (parentUl) parentUl.classList.add('shop-ai-option-list');

            // Option cards (colors, sizes, finishes, etc.) do NOT get title
            // links. Show action button linking to the item's own product page
            // when found in cache, otherwise fall back to variant matching on
            // the pinned product.
            var itemUrl = ShopAIChat.Formatting._findProductUrl(optionText);
            if (itemUrl || ShopAIChat.pinnedProduct) {
            const linkBtn = document.createElement('a');
            linkBtn.classList.add('shop-ai-option-link');
            linkBtn.title = 'View ' + optionText + ' on product page';
            linkBtn.setAttribute('aria-label', 'Open product page for ' + optionText);
            linkBtn.innerHTML =
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
              '<polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/>' +
              '</svg>';

            if (itemUrl) {
              // Direct link to the item's own product page
              linkBtn.href = ShopAIChat.UTM.addToUrl(itemUrl, 'option_card');
              linkBtn.target = '_blank';
              linkBtn.rel = 'noopener noreferrer';
            } else {
              // Fallback: variant matching on the pinned product
              linkBtn.href = '#';
              linkBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const product = ShopAIChat.pinnedProduct;
                if (!product) return;

                const handle  = product.handle;
                const baseUrl = product.url || ('/products/' + handle);

                if (!handle) {
                  window.open(baseUrl, '_blank', 'noopener,noreferrer');
                  return;
                }

                fetch('/products/' + handle + '.js')
                  .then(function(r) { return r.json(); })
                  .then(function(productData) {
                    var allVariants = productData.variants || [];
                    var optionNames = productData.options || [];
                    var needle = optionText.toLowerCase().trim();
                    var matched = null;

                    var allOptionValues = [];
                    optionNames.forEach(function(opt) {
                      (opt.values || []).forEach(function(v) { allOptionValues.push(v); });
                    });

                    if (allOptionValues.length) {
                      var bestVal = null, bestScore = -1;
                      allOptionValues.forEach(function(val) {
                        var vl = val.toLowerCase().trim();
                        var score = 0;
                        if (vl === needle) {
                          score = 100;
                        } else if (vl.includes(needle) || needle.includes(vl)) {
                          score = 60 * (Math.min(vl.length, needle.length) / Math.max(vl.length, needle.length));
                        } else {
                          var nw = needle.split(/\s+/).filter(Boolean);
                          var vw = vl.split(/\s+/).filter(Boolean);
                          var overlap = nw.filter(function(w) { return vw.indexOf(w) !== -1; }).length;
                          score = overlap > 0 ? (overlap / Math.max(nw.length, vw.length)) * 40 : 0;
                        }
                        if (score > bestScore) { bestScore = score; bestVal = vl; }
                      });
                      if (bestVal && bestScore >= 20) needle = bestVal;
                    }

                    for (var i = 0; i < Math.min(optionNames.length || 3, 3); i++) {
                      var optKey = 'option' + (i + 1);
                      var candidate = allVariants.find(function(v) {
                        return v[optKey] && v[optKey].toLowerCase().trim() === needle;
                      });
                      if (candidate) { matched = candidate; break; }
                    }

                    if (!matched) {
                      var cardText = li.textContent.toLowerCase();
                      var bestPos = Infinity;
                      allVariants.forEach(function(v) {
                        for (var j = 1; j <= 3; j++) {
                          var val = v['option' + j];
                          if (!val) continue;
                          var pos = cardText.indexOf(val.toLowerCase().trim());
                          if (pos !== -1 && pos < bestPos) { bestPos = pos; matched = v; }
                        }
                      });
                    }

                    if (!matched && allVariants.length) matched = allVariants[0];

                    var variantUrl = matched ? (baseUrl + '?variant=' + matched.id) : baseUrl;
                    var url = ShopAIChat.UTM.addToUrl(variantUrl, 'option_card');
                    window.open(url, '_blank', 'noopener,noreferrer');
                  })
                  .catch(function() {
                    window.open(baseUrl, '_blank', 'noopener,noreferrer');
                  });
              });
            } // end if/else itemUrl

            li.appendChild(linkBtn);
            } // end if (itemUrl || pinnedProduct)
          });
        // ────────────────────────────────────────────────────────────────────


        // Add title-link + lightweight separators for product entries in
        // non-card text responses.
        this.decorateProductEntries(element);

        return { chips };
      },

      /**
       * Convert Markdown text to HTML with list support
       * @param {string} text - Markdown text to convert
       * @returns {string} HTML content
       */
      convertMarkdownToHtml: function(text) {
        text = text.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');
        const lines = text.split('\n');
        let currentList = null;
        let listItems = [];
        let htmlContent = '';
        let startNumber = 1;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const headingMatch = line.match(/^\s*(#{1,6})\s+(.*)$/);
          const unorderedMatch = line.match(/^\s*([-*])\s+(.*)/);
          const orderedMatch = line.match(/^\s*(\d+)[\.)]\s+(.*)/);

          if (headingMatch) {
            if (currentList) {
              htmlContent += currentList === 'ul'
                ? '<ul>' + listItems.join('') + '</ul>'
                : `<ol start="${startNumber}">` + listItems.join('') + '</ol>';
              listItems = [];
              currentList = null;
            }

            var level = headingMatch[1].length;
            var headingText = (headingMatch[2] || '').replace(/<\/?strong>/g, '').trim();
            var uiLevel = Math.min(Math.max(level, 3), 6);
            htmlContent += `<h${uiLevel} class="shop-ai-md-heading shop-ai-md-heading-${uiLevel}">${headingText}</h${uiLevel}>`;
          } else if (unorderedMatch) {
            if (currentList !== 'ul') {
              if (currentList === 'ol') {
                htmlContent += `<ol start="${startNumber}">` + listItems.join('') + '</ol>';
                listItems = [];
              }
              currentList = 'ul';
            }
            listItems.push('<li>' + unorderedMatch[2] + '</li>');
          } else if (orderedMatch) {
            if (currentList !== 'ol') {
              if (currentList === 'ul') {
                htmlContent += '<ul>' + listItems.join('') + '</ul>';
                listItems = [];
              }
              currentList = 'ol';
              startNumber = parseInt(orderedMatch[1], 10);
            }
            listItems.push('<li>' + orderedMatch[2] + '</li>');
          } else {
            if (currentList) {
              htmlContent += currentList === 'ul'
                ? '<ul>' + listItems.join('') + '</ul>'
                : `<ol start="${startNumber}">` + listItems.join('') + '</ol>';
              listItems = [];
              currentList = null;
            }

            if (line.trim() === '') {
              htmlContent += '<br>';
            } else {
              htmlContent += '<p>' + line + '</p>';
            }
          }
        }

        if (currentList) {
          htmlContent += currentList === 'ul'
            ? '<ul>' + listItems.join('') + '</ul>'
            : `<ol start="${startNumber}">` + listItems.join('') + '</ol>';
        }

        htmlContent = htmlContent.replace(/<\/p><p>/g, '</p>\n<p>');
        return htmlContent;
      }
    },

    /**
     * UTM parameter helper
     */
    UTM: {
      addToUrl: function(url, contentType) {
        if (!url || typeof url !== 'string' || url.startsWith('#')) return url;
        try {
          let base;
          if (!/^https?:\/\//i.test(url)) {
            // For relative URLs prefer the explicit shop domain set from Liquid;
            // window.location.origin can be the string "null" in sandboxed contexts.
            const shopOrigin = window.shopDomain
              ? 'https://' + window.shopDomain
              : (window.location.origin !== 'null' ? window.location.origin : null);
            base = shopOrigin || undefined;
          }
          if (!base && !/^https?:\/\//i.test(url)) return url; // can't resolve relative URL
          const parsed = new URL(url, base);
          parsed.searchParams.set('utm_source', 'ai_chatbot');
          parsed.searchParams.set('utm_medium', 'chat');
          parsed.searchParams.set('utm_campaign', 'ai_recommendation');
          if (contentType) parsed.searchParams.set('utm_content', contentType);
          return parsed.toString();
        } catch (e) {
          if (!/^https?:\/\//i.test(url)) return url; // drop unresolvable relative URLs
          const sep = url.includes('?') ? '&' : '?';
          return url + sep + 'utm_source=ai_chatbot&utm_medium=chat&utm_campaign=ai_recommendation' +
            (contentType ? '&utm_content=' + encodeURIComponent(contentType) : '');
        }
      }
    },

    /**
     * Card detection for collections and blog posts found in assistant message links
     */
    Cards: {
      detectAndRender: function(messageElement, messagesContainer) {
        if (!messageElement || messageElement.dataset.cardsRendered) return;
        messageElement.dataset.cardsRendered = 'true';

        const links = messageElement.querySelectorAll('a[href]');
        const seen = {};
        const toRender = [];

        links.forEach(function(link) {
          const href = link.href;
          if (!href || seen[href]) return;
          seen[href] = true;

          const text = (link.textContent || '').trim();
          if (/\/collections\//.test(href)) {
            toRender.push({ type: 'collection', url: href, title: text || 'View Collection' });
          } else if (/\/blogs\/.+\/[^/]+$/.test(href)) {
            toRender.push({ type: 'blog', url: href, title: text || 'Read Article' });
          } else if (/\/blogs\//.test(href)) {
            toRender.push({ type: 'blog_category', url: href, title: text || 'View Blog' });
          }
        });

        if (toRender.length === 0) return;

        const section = document.createElement('div');
        section.classList.add('shop-ai-cards-section');

        toRender.forEach(function(item) {
          section.appendChild(ShopAIChat.Cards.createCard(item));
        });

        messagesContainer.appendChild(section);
        // Don't scroll — user is anchored at the top of the bot message; let them
        // read the text before the cards come into view naturally on scroll.
      },

      createCard: function(item) {
        const utmUrl = ShopAIChat.UTM.addToUrl(item.url, item.type + '_card');
        const icons = { collection: '🗂️', blog: '📝', blog_category: '📚' };
        const labels = { collection: 'Collection', blog: 'Blog Post', blog_category: 'Blog' };

        const card = document.createElement('a');
        card.classList.add('shop-ai-result-card');
        card.href = utmUrl;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';

        const icon = document.createElement('span');
        icon.classList.add('shop-ai-card-icon');
        icon.textContent = icons[item.type] || '🔗';

        const info = document.createElement('div');
        info.classList.add('shop-ai-card-info');

        const typeLabel = document.createElement('span');
        typeLabel.classList.add('shop-ai-card-type');
        typeLabel.textContent = labels[item.type] || 'Link';

        const title = document.createElement('span');
        title.classList.add('shop-ai-card-title');
        title.textContent = item.title;

        info.appendChild(typeLabel);
        info.appendChild(title);

        const arrow = document.createElement('span');
        arrow.classList.add('shop-ai-card-arrow');
        arrow.textContent = '→';

        card.appendChild(icon);
        card.appendChild(info);
        card.appendChild(arrow);

        return card;
      }
    },

    /**
     * API communication and data handling
     */
    API: {
      /**
       * Stream a response from the API
       * @param {string} userMessage - User's message text
       * @param {string} conversationId - Conversation ID for context
       * @param {HTMLElement} messagesContainer - The messages container
       */
      streamResponse: async function(userMessage, conversationId, messagesContainer) {
        let currentMessageElement = null;
        // Shared state so cart chips are shown AFTER the AI's confirmation
        // message, regardless of which resolves first (cart add or stream end).
        const cartChips = { pending: false, streamEnded: false };
        try {
          const promptType = window.shopChatConfig?.promptType || "standardAssistant";
          const requestBody = JSON.stringify({
            message: userMessage,          // full text sent to the AI (may include product context)
            display_message: userMessage
              .replace(/^\[PINNED_PRODUCT_CONTEXT\][\s\S]*?\[\/PINNED_PRODUCT_CONTEXT\]\n\n/, '')
              .replace(/^\[CART_CONTEXT:[^\]]*\]\s*/, ''), // strip cart follow-up context too
            conversation_id: conversationId,
            prompt_type: promptType
          });

          const streamUrl = (window.shopChatConfig?.appUrl || 'https://localhost:3458') + '/chat';
          const shopId = window.shopId;
          const shopDomain = window.shopDomain;

          const response = await fetch(streamUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream',
              'X-Shopify-Shop-Id': shopId,
              'X-Shopify-Shop-Domain': shopDomain
            },
            body: requestBody
          });

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          // Create initial bot-row with avatar + message element but do NOT
          // append to the DOM yet. The typing indicator stays visible until the
          // first text chunk arrives, preventing a blank placeholder flash.
          const initRow = document.createElement('div');
          initRow.classList.add('shop-ai-bot-row');
          const initAvatar = document.createElement('div');
          initAvatar.classList.add('shop-ai-bot-avatar-sm');
          initAvatar.textContent = '\u2726';
          let messageElement = document.createElement('div');
          messageElement.classList.add('shop-ai-message', 'assistant');
          messageElement.textContent = '';
          messageElement.dataset.rawText = '';
          initRow.appendChild(initAvatar);
          initRow.appendChild(messageElement);
          // Row intentionally NOT appended here — see 'chunk' handler below.
          currentMessageElement = messageElement;

          // Process the stream
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  this.handleStreamEvent(data, currentMessageElement, messagesContainer, userMessage,
                    (newElement) => { currentMessageElement = newElement; }, cartChips);
                } catch (e) {
                  console.error('Error parsing event data:', e, line);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error in streaming:', error);
          ShopAIChat.UI.removeTypingIndicator();
          ShopAIChat.Message.add("Sorry, I couldn't process your request. Please try again later.",
            'assistant', messagesContainer);
        }
      },

      /**
       * Handle stream events from the API
       * @param {Object} data - Event data
       * @param {HTMLElement} currentMessageElement - Current message element being updated
       * @param {HTMLElement} messagesContainer - The messages container
       * @param {string} userMessage - The original user message
       * @param {Function} updateCurrentElement - Callback to update the current element reference
       */
      handleStreamEvent: function(data, currentMessageElement, messagesContainer, userMessage, updateCurrentElement, cartChips) {
        switch (data.type) {
          case 'id':
            if (data.conversation_id) {
              sessionStorage.setItem('shopAiConversationId', data.conversation_id);
            }
            break;

          case 'shop_config':
            // Apply app-admin settings, overriding any theme extension defaults
            if (data.config) {
              const cfg = data.config;
              const container = document.querySelector('.shop-ai-chat-container');
              if (container && cfg.bubbleColor) {
                container.style.setProperty('--c-accent', cfg.bubbleColor);
                const bubble = container.querySelector('.shop-ai-chat-bubble');
                if (bubble) bubble.style.backgroundColor = cfg.bubbleColor;
              }
              if (window.shopChatConfig) {
                if (cfg.welcomeMsg)  window.shopChatConfig.welcomeMessage = cfg.welcomeMsg;
                if (cfg.promptType)  window.shopChatConfig.promptType     = cfg.promptType;
                if (cfg.bubbleColor) window.shopChatConfig.bubbleColor    = cfg.bubbleColor;
              }
            }
            break;

          case 'chunk':
            // First chunk: remove typing indicator, mount the bot row, then
            // scroll so the USER'S MESSAGE is at the top — the user reads from
            // their question through to the AI answer naturally.
            // Skip the scroll if the user has manually scrolled up to browse
            // previous content — respect their position.
            if (!currentMessageElement.isConnected) {
              ShopAIChat.UI.removeTypingIndicator();
              const rowToMount = currentMessageElement.parentNode;
              if (rowToMount) {
                messagesContainer.appendChild(rowToMount);
                ShopAIChat.hapticFeedback(); // mild pulse when AI starts responding
                if (ShopAIChat.UI.autoScroll) {
                  // User is at/near the bottom — scroll to show their question.
                  const userMsgs = messagesContainer.querySelectorAll('.shop-ai-message.user');
                  const scrollTarget = userMsgs.length > 0
                    ? userMsgs[userMsgs.length - 1]
                    : rowToMount;
                  ShopAIChat.UI.scrollToElement(scrollTarget);
                }
                // If autoScroll is false the user has scrolled up — leave them there.
              }
            }
            currentMessageElement.dataset.rawText += data.chunk;
            // Keep the same markdown-rendered UI during streaming and after completion.
            // QUICK_REPLIES extraction is deferred until message_complete.
            ShopAIChat.Formatting.formatMessageContent(currentMessageElement, { extractChips: false });
            // No auto-scroll during streaming — view stays anchored at the
            // user's question so they can read from beginning.
            break;

          case 'message_complete':
            ShopAIChat.UI.removeTypingIndicator();
            if (!currentMessageElement.dataset.rawText) {
              const emptyRow = currentMessageElement.closest('.shop-ai-bot-row');
              if (emptyRow) emptyRow.remove();
            } else {
              const fmtResult = ShopAIChat.Formatting.formatMessageContent(currentMessageElement);
              ShopAIChat.Cards.detectAndRender(currentMessageElement, messagesContainer);
              if (fmtResult && fmtResult.chips && fmtResult.chips.length > 0) {
                ShopAIChat.renderQuickReplies(fmtResult.chips, messagesContainer);
              }
            }
            // No scroll — user is already positioned at the top of this message.
            break;

          case 'end_turn':
            ShopAIChat.UI.removeTypingIndicator();
            // Show cart action chips now if the cart add already resolved while
            // the AI was streaming its confirmation message.
            if (cartChips) {
              cartChips.streamEnded = true;
              if (cartChips.pending) {
                cartChips.pending = false;
                ShopAIChat.showCartActionChips(messagesContainer);
              }
            }
            break;

          case 'error':
            console.error('Stream error:', data.error);
            ShopAIChat.UI.removeTypingIndicator();
            currentMessageElement.textContent = "Sorry, I couldn't process your request. Please try again later.";
            break;

          case 'rate_limit_exceeded':
            console.error('Rate limit exceeded:', data.error);
            ShopAIChat.UI.removeTypingIndicator();
            currentMessageElement.textContent = data.details
              || "I'm a little busy right now — please try again in a moment.";
            break;

          case 'auth_required':
            // Save the last user message for resuming after authentication
            sessionStorage.setItem('shopAiLastMessage', userMessage || '');
            break;

          case 'product_results':
            ShopAIChat.UI.displayProductResults(data.products);
            break;

          case 'cart_add_request':
            // The server has validated sampling eligibility and delegated the
            // actual cart mutation to the browser.
            (function() {
              var items = (data.items || []).map(function(item) {
                var numericId = typeof item.id === 'string' && item.id.includes('/')
                  ? item.id.split('/').pop()
                  : String(item.id);
                return { id: parseInt(numericId, 10), quantity: item.quantity || 1 };
              }).filter(function(i) { return !isNaN(i.id); });

              if (!items.length) return;

              // Process each item sequentially using the user-supplied addAndSyncCart logic
              items.reduce(function(promise, item) {
                return promise.then(function() {
                  return addAndSyncCart(item.id, item.quantity);
                });
              }, Promise.resolve())
              .then(function() {
                // Defer chips until end_turn so they appear AFTER the AI's
                // confirmation message, not before it.
                if (cartChips && !cartChips.streamEnded) {
                  cartChips.pending = true;
                } else {
                  ShopAIChat.showCartActionChips(messagesContainer);
                }
              })
              .catch(function(err) {
                console.error('[ShopAI] addAndSyncCart error:', err);
              });
            })();
            break;

          case 'cart_updated':
            // Legacy event kept for backwards compatibility; no-op now that
            // cart additions are handled via cart_add_request above.
            break;

          case 'tool_use':
            // Internal tool calls are not shown to users — the typing indicator
            // already communicates that the assistant is working.
            break;

          case 'new_message':
            ShopAIChat.Formatting.formatMessageContent(currentMessageElement);
            ShopAIChat.UI.showTypingIndicator();

            // Create next bot-row with avatar
            const newRow = document.createElement('div');
            newRow.classList.add('shop-ai-bot-row');
            const newAvatar = document.createElement('div');
            newAvatar.classList.add('shop-ai-bot-avatar-sm');
            newAvatar.textContent = '\u2726';
            const newMessageElement = document.createElement('div');
            newMessageElement.classList.add('shop-ai-message', 'assistant');
            newMessageElement.textContent = '';
            newMessageElement.dataset.rawText = '';
            newRow.appendChild(newAvatar);
            newRow.appendChild(newMessageElement);
            // Row intentionally NOT appended here — lazy-mounted on first chunk.

            updateCurrentElement(newMessageElement);
            break;

          case 'content_block_complete':
            // Do not show typing indicator here — this fires
            // after the message is already complete, so showing one causes a
            // permanent indicator that end_turn cannot fully clear.
            break;
        }
      },

      /**
       * Fetch chat history from the server
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      fetchChatHistory: async function(conversationId, messagesContainer) {
        try {
          // Show a loading message
          const loadingMessage = document.createElement('div');
          loadingMessage.classList.add('shop-ai-message', 'assistant');
          loadingMessage.textContent = "Loading conversation history...";
          messagesContainer.appendChild(loadingMessage);

          // Fetch history from the server
          const historyUrl = `${window.shopChatConfig?.appUrl || 'https://localhost:3458'}/chat?history=true&conversation_id=${encodeURIComponent(conversationId)}`;
          console.log('Fetching history from:', historyUrl);

          const response = await fetch(historyUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'X-Shopify-Shop-Domain': window.shopDomain
            },
            mode: 'cors'
          });

          if (!response.ok) {
            console.error('History fetch failed:', response.status, response.statusText);
            throw new Error('Failed to fetch chat history: ' + response.status);
          }

          const data = await response.json();

          // No messages — treat as a cleared/expired conversation and reset
          // all session-scoped chat state, including pinned product context.
          if (!data.messages || data.messages.length === 0) {
            messagesContainer.removeChild(loadingMessage);
            sessionStorage.removeItem('shopAiConversationId');
            ShopAIChat.UI.unpinProduct();
            ShopAIChat.UI.showWelcome();
            return;
          }

          messagesContainer.removeChild(loadingMessage);

          // Group messages by conversation turn (each user message starts a new turn).
          // Within each turn, text messages are rendered before product_results so
          // the order is identical to the live-streaming experience regardless of
          // how the DB happened to store them.
          var turns = [];
          var currentTurn = { messages: [], products: null };

          data.messages.forEach(function(msg) {
            if (msg.role === 'user') {
              // Each user message opens a new turn; flush the previous one first.
              turns.push(currentTurn);
              currentTurn = { messages: [msg], products: null };
            } else {
              var isProducts = false;
              var productsData = null;
              try {
                var pp = JSON.parse(msg.content);
                if (pp && pp._chat_type === 'product_results') {
                  isProducts = true;
                  productsData = pp.products || [];
                }
              } catch(_) {}
              if (isProducts) {
                currentTurn.products = productsData; // keep last one per turn
              } else {
                currentTurn.messages.push(msg);
              }
            }
          });
          turns.push(currentTurn); // flush final turn

          // Pre-populate the product results cache from ALL turns BEFORE
          // rendering messages. This ensures _findProductUrl can resolve
          // product URLs when decorating text (option cards, inline links).
          turns.forEach(function(turn) {
            if (turn.products && turn.products.length) {
              ShopAIChat._lastProductResults = (ShopAIChat._lastProductResults || []).concat(turn.products);
            }
          });

          // Render: for every turn, render text messages first then product cards.
          turns.forEach(function(turn) {
            turn.messages.forEach(function(message) {
              try {
                var parsed = JSON.parse(message.content);

                var blocks;
                if (Array.isArray(parsed)) {
                  // Format 2 – plain content array
                  blocks = parsed;
                } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.content)) {
                  // Format 3 – {content:[…]} (Legacy wrapped format)
                  blocks = parsed.content;
                }

                if (blocks) {
                  // Join all text blocks into ONE bubble; skip tool_use / tool_result blocks.
                  var textParts = blocks.filter(function(b) {
                    return b && b.type === 'text' && b.text;
                  });
                  if (textParts.length > 0) {
                    var fullText = textParts.map(function(b) { return b.text; }).join('');
                    ShopAIChat.Message.add(fullText, message.role, messagesContainer);
                  }
                } else {
                  // Format 1: raw string — only show for user messages
                  if (message.role === 'user' && message.content) {
                    ShopAIChat.Message.add(message.content, 'user', messagesContainer);
                  }
                }
              } catch (_) {
                // JSON parse failed → plain string user message
                if (message.role === 'user' && message.content) {
                  ShopAIChat.Message.add(message.content, 'user', messagesContainer);
                }
              }
            });

            // Product cards always render AFTER the text messages for this turn.
            if (turn.products !== null) {
              ShopAIChat.UI.displayProductResults(turn.products);
            }
          });

          ShopAIChat.UI.scrollToBottom();

        } catch (error) {
          console.error('Error fetching chat history:', error);

          // Remove loading message if it exists
          const existingLoader = messagesContainer.querySelector('.shop-ai-message.assistant');
          if (existingLoader && existingLoader.textContent === 'Loading conversation history...') {
            messagesContainer.removeChild(existingLoader);
          }

          // Clear stale session and show welcome screen
          sessionStorage.removeItem('shopAiConversationId');
          ShopAIChat.UI.unpinProduct();
          ShopAIChat.UI.showWelcome();
        }
      }
    },

    /**
     * Authentication-related functionality
     */
    Auth: {
      /**
       * Opens an authentication popup window
       * @param {string|HTMLElement} authUrlOrElement - The auth URL or link element that was clicked
       */
      openAuthPopup: function(authUrlOrElement) {
        let authUrl;
        if (typeof authUrlOrElement === 'string') {
          // If a string URL was passed directly
          authUrl = authUrlOrElement;
        } else {
          // If an element was passed
          authUrl = authUrlOrElement.getAttribute('data-auth-url');
          if (!authUrl) {
            console.error('No auth URL found in element');
            return;
          }
        }

        // Open the popup window centered in the screen
        const width = 600;
        const height = 700;
        const left = (window.innerWidth - width) / 2 + window.screenX;
        const top = (window.innerHeight - height) / 2 + window.screenY;

        const popup = window.open(
          authUrl,
          'ShopifyAuth',
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );

        // Focus the popup window
        if (popup) {
          popup.focus();
        } else {
          // If popup was blocked, show a message
          alert('Please allow popups for this site to authenticate with Shopify.');
        }

        // Start polling for token availability
        const conversationId = sessionStorage.getItem('shopAiConversationId');
        if (conversationId) {
          const messagesContainer = document.querySelector('.shop-ai-chat-messages');

          // Add a message to indicate authentication is in progress
          ShopAIChat.Message.add("Authentication in progress. Please complete the process in the popup window.",
            'assistant', messagesContainer);

          this.startTokenPolling(conversationId, messagesContainer);
        }
      },

      /**
       * Start polling for token availability
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      startTokenPolling: function(conversationId, messagesContainer) {
        if (!conversationId) return;

        console.log('Starting token polling for conversation:', conversationId);
        const pollingId = 'polling_' + Date.now();
        sessionStorage.setItem('shopAiTokenPollingId', pollingId);

        let attemptCount = 0;
        const maxAttempts = 30;

        const poll = async () => {
          if (sessionStorage.getItem('shopAiTokenPollingId') !== pollingId) {
            console.log('Another polling session has started, stopping this one');
            return;
          }

          if (attemptCount >= maxAttempts) {
            console.log('Max polling attempts reached, stopping');
            return;
          }

          attemptCount++;

          try {
            const tokenUrl = (window.shopChatConfig?.appUrl || 'https://localhost:3458') + '/auth/token-status?conversation_id=' +
              encodeURIComponent(conversationId);
            const response = await fetch(tokenUrl);

            if (!response.ok) {
              throw new Error('Token status check failed: ' + response.status);
            }

            const data = await response.json();

            if (data.status === 'authorized') {
              console.log('Token available, resuming conversation');
              const message = sessionStorage.getItem('shopAiLastMessage');

              if (message) {
                sessionStorage.removeItem('shopAiLastMessage');
                setTimeout(() => {
                  ShopAIChat.Message.add("Authorization successful! I'm now continuing with your request.",
                    'assistant', messagesContainer);
                  ShopAIChat.UI.showTypingIndicator();
                  ShopAIChat.API.streamResponse(message, conversationId, messagesContainer);
                }, 500);
              }

              sessionStorage.removeItem('shopAiTokenPollingId');
              return;
            }

            console.log('Token not available yet, polling again in 10s');
            setTimeout(poll, 10000);
          } catch (error) {
            console.error('Error polling for token status:', error);
            setTimeout(poll, 10000);
          }
        };

        setTimeout(poll, 2000);
      }
    },

    /**
     * Formats a number of cents into a currency string using a Shopify format
     * string.
     *
     * https://help.shopify.com/en/manual/international/pricing/currency-formatting#currency-formatting-options
     *
     * Originally from: https://gist.github.com/stewartknapman/8d8733ea58d2314c373e94114472d44c
     *
     * @param {number} cents - The number of cents to format.
     * @param {string} formatString - The format string to use.
     * @returns {string} The formatted currency string.
     */
    formatCurrency: function(cents, formatString) {
      if (!formatString) return '';

      var placeholderRegex = /{{\s*(\w+)\s*}}/;

      /**
       * Formats a number of cents into a currency string using the provided
       * precision, thousands separator, and decimal separator.
       * @param {number} number - The number of cents to format.
       * @param {number} precision - The number of decimal places to include.
       * @param {string} thousands - The character to use as the thousands separator.
       * @param {string} decimal - The character to use as the decimal separator.
       * @returns {string} The formatted currency string.
       */
      function formatWithDelimiters(number, precision, thousands, decimal) {
        if (precision === undefined) precision = 2;
        if (thousands === undefined) thousands = ',';
        if (decimal === undefined) decimal = '.';

        if (isNaN(number) || number == null) {
          return '0';
        }

        var numString = (number / 100.0).toFixed(precision);
        var parts = numString.split('.');
        var dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands);
        var centsPart = parts[1] ? decimal + parts[1] : '';
        return dollars + centsPart;
      }

      return formatString.replace(placeholderRegex, function(match, placeholder) {
        switch (placeholder) {
          case 'amount':
            // Ex. 1,134.65
            return formatWithDelimiters(cents, 2);
          case 'amount_no_decimals':
            // Ex. 1,135
            return formatWithDelimiters(cents, 0);
          case 'amount_with_comma_separator':
            // Ex. 1.134,65
            return formatWithDelimiters(cents, 2, '.', ',');
          case 'amount_no_decimals_with_comma_separator':
            // Ex. 1.135
            return formatWithDelimiters(cents, 0, '.', ',');
          case 'amount_with_apostrophe_separator':
            // Ex. 1'134.65
            return formatWithDelimiters(cents, 2, "'", '.');
          case 'amount_no_decimals_with_space_separator':
            // Ex. 1 135
            return formatWithDelimiters(cents, 0, ' ');
          case 'amount_with_space_separator':
            // 1 134,65
            return formatWithDelimiters(cents, 2, ' ', ',');
          case 'amount_with_period_and_space_separator':
            // 1 134.65
            return formatWithDelimiters(cents, 2, ' ', '.');
          default:
            return match;
        }
      });
    },

    Product: {
      createCard: function(product) {
        // URL is always an absolute https URL constructed by the backend from
        // the product's real handle fetched via Admin GraphQL.
        const utmUrl = product.url
          ? ShopAIChat.UTM.addToUrl(product.url, 'product_card')
          : '';

        // Use div (not <a>) so the "View product" CTA can be a proper <a>
        // without invalid nested-anchor HTML. Click on the card body navigates via JS.
        const card = document.createElement('div');
        card.classList.add('shop-ai-product-card');
        if (utmUrl) {
          card.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') return; // let the anchor handle itself
            window.open(utmUrl, '_blank', 'noopener,noreferrer');
          });
        }

        // ── Image ──────────────────────────────────────────────────────
        const imageContainer = document.createElement('div');
        imageContainer.classList.add('shop-ai-product-image');

        // Try every known image field path from Shopify and UCP catalog formats
        const imageUrl = product.image_url ||
          product.imageUrl ||
          product.image?.url ||
          product.image?.src ||
          product.featuredImage?.url ||
          product.featuredImage?.src ||
          (product.images && (product.images[0]?.url || product.images[0]?.src)) ||
          (product.media && product.media[0]?.preview?.image?.url) ||
          '';

        if (imageUrl) {
          const image = document.createElement('img');
          image.src = imageUrl;
          image.alt = product.title || 'Product';
          image.loading = 'lazy';
          image.onerror = function() {
            this.style.display = 'none';
            imageContainer.classList.add('shop-ai-product-image--placeholder');
          };
          imageContainer.appendChild(image);
        } else {
          imageContainer.classList.add('shop-ai-product-image--placeholder');
        }

        // Badge: explicit badge OR discount %
        const priceCents   = product.price_cents || 0;
        const compareCents = product.compare_price_cents || 0;
        const hasDiscount  = compareCents > priceCents && priceCents > 0;
        const discountPct  = hasDiscount ? Math.round((1 - priceCents / compareCents) * 100) : 0;
        const badgeText = product.badge || (discountPct >= 5 ? '-' + discountPct + '%' : '');

        if (badgeText) {
          const badge = document.createElement('span');
          badge.classList.add('shop-ai-product-badge');
          const bl = badgeText.toLowerCase();
          if (bl.includes('rated') || bl.includes('best')) badge.classList.add('top-rated');
          else if (bl === 'new') badge.classList.add('new');
          badge.textContent = badgeText;
          imageContainer.appendChild(badge);
        }

        card.appendChild(imageContainer);

        // ── Pin button (top-right of image) ───────────────────────────────
        const pinBtn = document.createElement('button');
        pinBtn.classList.add('shop-ai-product-pin-btn');
        pinBtn.title = 'Pin for context';
        pinBtn.setAttribute('aria-label', 'Pin product as conversation context');
        pinBtn.dataset.productId = String(product.id || product.handle || '');
        pinBtn.innerHTML =
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
        pinBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          // Toggle: clicking the active pin unpins; clicking a new one pins
          if (ShopAIChat.pinnedProduct &&
              String(ShopAIChat.pinnedProduct.id || ShopAIChat.pinnedProduct.handle) ===
              String(product.id || product.handle)) {
            ShopAIChat.UI.unpinProduct();
          } else {
            ShopAIChat.UI.pinProduct(product);
          }
        });
        imageContainer.appendChild(pinBtn);
        // Mark active if this product is already pinned
        if (ShopAIChat.pinnedProduct &&
            String(ShopAIChat.pinnedProduct.id || ShopAIChat.pinnedProduct.handle) ===
            String(product.id || product.handle)) {
          pinBtn.classList.add('active');
          pinBtn.title = 'Pinned — questions will reference this product';
        }

        // ── Info ───────────────────────────────────────────────────────
        const info = document.createElement('div');
        info.classList.add('shop-ai-product-info');

        if (product.brand) {
          const brand = document.createElement('div');
          brand.classList.add('shop-ai-product-brand');
          brand.textContent = product.brand;
          info.appendChild(brand);
        }

        // Sampling badge — shown when metafield additional_data.enable_sampling = true
        if (product.enable_sampling) {
          const samplingBadge = document.createElement('div');
          samplingBadge.classList.add('shop-ai-sampling-badge');
          // Inline scissors SVG + label
          samplingBadge.innerHTML =
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="2" y="3" width="9" height="6" rx="1"/>' +
            '<rect x="13" y="3" width="9" height="6" rx="1"/>' +
            '<rect x="2" y="11" width="13" height="6" rx="1"/>' +
            '<rect x="17" y="11" width="5" height="6" rx="1"/>' +
            '<rect x="2" y="19" width="6" height="3" rx="1"/>' +
            '<rect x="10" y="19" width="12" height="3" rx="1"/>' +
            '</svg>' +
            '<span>Samples Available</span>';
          info.appendChild(samplingBadge);
        }

        const title = document.createElement('p');
        title.classList.add('shop-ai-product-title');
        // Only link the title when there is NO action CTA below it;
        // when the CTA exists, the title stays plain text to avoid redundancy.
        const hasCta = !!utmUrl; // CTA is rendered when utmUrl exists
        if (!hasCta && product.url) {
          const titleLink = document.createElement('a');
          titleLink.href = ShopAIChat.UTM.addToUrl(product.url, 'product_title');
          titleLink.target = '_blank';
          titleLink.rel = 'noopener noreferrer';
          titleLink.textContent = product.title || 'Product';
          title.appendChild(titleLink);
        } else {
          title.textContent = product.title || 'Product';
        }
        info.appendChild(title);

        if (product.rating) {
          const starsRow = document.createElement('div');
          starsRow.classList.add('shop-ai-product-stars');
          const rating = parseFloat(product.rating) || 0;
          for (let i = 1; i <= 5; i++) {
            const star = document.createElement('span');
            star.textContent = '\u2605';
            star.classList.add(i <= Math.round(rating) ? 'star-filled' : 'star-empty');
            starsRow.appendChild(star);
          }
          if (product.reviews) {
            const rev = document.createElement('span');
            rev.textContent = '(' + Number(product.reviews).toLocaleString() + ')';
            starsRow.appendChild(rev);
          }
          info.appendChild(starsRow);
        }

        // Price using Shopify money format (shop.money_format from Liquid)
        const moneyFormat = window.shopChatConfig?.moneyFormat || '${{amount}}';
        const priceStr = priceCents
          ? ShopAIChat.formatCurrency(priceCents, moneyFormat)
          : '';
        const origStr = (hasDiscount && compareCents)
          ? ShopAIChat.formatCurrency(compareCents, moneyFormat)
          : '';

        if (priceStr) {
          const priceRow = document.createElement('div');
          priceRow.classList.add('shop-ai-product-price-row');

          const priceEl = document.createElement('span');
          priceEl.classList.add('shop-ai-product-price');
          priceEl.textContent = priceStr;
          priceRow.appendChild(priceEl);

          if (origStr) {
            const origEl = document.createElement('span');
            origEl.classList.add('shop-ai-product-price-original');
            origEl.textContent = origStr;
            priceRow.appendChild(origEl);
          }

          info.appendChild(priceRow);
        }

        // "View product →" as a proper <a> element (card is a div, no nesting issue)
        if (utmUrl) {
          const cta = document.createElement('a');
          cta.classList.add('shop-ai-product-cta');
          cta.href = utmUrl;
          cta.target = '_blank';
          cta.rel = 'noopener noreferrer';
          cta.textContent = 'View product \u2192';
          info.appendChild(cta);
        }

        card.appendChild(info);
        return card;
      }
    },

    /**
     * Show post-cart-add action chips: "View Cart" (opens cart drawer) and
     * "Continue Shopping" (triggers AI follow-up questions).
     */
    showCartActionChips: function(messagesContainer) {
      // Remove any existing reply chip rows (AI-generated QUICK_REPLIES etc.)
      // so we don't end up with duplicate "Continue Shopping" options.
      messagesContainer.querySelectorAll('.shop-ai-reply-chips').forEach(function(el) {
        el.remove();
      });

      const row = document.createElement('div');
      row.classList.add('shop-ai-reply-chips');

      // ── View Cart chip (cart icon + label, always on one line) ──────────
      const viewWrapper = document.createElement('div');
      viewWrapper.classList.add('shop-ai-chip-wrapper');
      const viewBtn = document.createElement('button');
      viewBtn.classList.add('shop-ai-reply-chip');

      // Use an inner flex container so the icon and text never wrap.
      const viewInner = document.createElement('span');
      viewInner.classList.add('shop-ai-chip-text');
      viewInner.style.cssText = 'display:inline-flex;align-items:center;gap:5px;white-space:nowrap';

      const cartSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      cartSvg.setAttribute('width', '13');
      cartSvg.setAttribute('height', '13');
      cartSvg.setAttribute('viewBox', '0 0 24 24');
      cartSvg.setAttribute('fill', 'none');
      cartSvg.setAttribute('stroke', 'currentColor');
      cartSvg.setAttribute('stroke-width', '2.2');
      cartSvg.setAttribute('stroke-linecap', 'round');
      cartSvg.setAttribute('stroke-linejoin', 'round');
      cartSvg.setAttribute('aria-hidden', 'true');
      cartSvg.style.flexShrink = '0';
      cartSvg.innerHTML =
        '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>' +
        '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>';
      viewInner.appendChild(cartSvg);
      viewInner.appendChild(document.createTextNode('View Cart'));
      viewBtn.appendChild(viewInner);

      viewBtn.addEventListener('click', async function() {
        row.remove();
        const cartDrawer = document.querySelector('cart-drawer');
        if (cartDrawer) {
          // Fetch latest sections from the cart endpoint, then call renderContents.
          // renderContents updates ALL sections (drawer + bubble) and opens the
          // drawer itself — no need to call open() separately.
          try {
            const formData = new FormData();
            formData.append(
              'sections',
              cartDrawer.getSectionsToRender().map(function(s) { return s.id; })
            );
            formData.append('sections_url', location.pathname);
            const cartRes  = await fetch('/cart/update.js', { method: 'POST', body: formData });
            const cartData = await cartRes.json();
            cartDrawer.renderContents(cartData); // updates drawer HTML + opens it
          } catch (err) {
            console.error('[ShopAI] Failed to render cart sections for drawer:', err);
            // Fallback: open the drawer without refreshing its contents
            if (typeof cartDrawer.open === 'function') cartDrawer.open();
          }
        }
        ShopAIChat.UI.closeChatWindow();
      });
      viewWrapper.appendChild(viewBtn);

      // ── Continue Shopping chip ───────────────────────────────────────────
      const continueWrapper = document.createElement('div');
      continueWrapper.classList.add('shop-ai-chip-wrapper');
      const continueBtn = document.createElement('button');
      continueBtn.classList.add('shop-ai-reply-chip');
      const continueSpan = document.createElement('span');
      continueSpan.classList.add('shop-ai-chip-text');
      continueSpan.textContent = 'Continue Shopping';
      continueBtn.appendChild(continueSpan);
      continueBtn.addEventListener('click', function() {
        row.remove();
        const conversationId = sessionStorage.getItem('shopAiConversationId');
        const followUp =
          '[CART_CONTEXT: Item was just successfully added to the cart. ' +
          'Based on the conversation so far, ask the customer a natural follow-up ' +
          'question to help them continue shopping — e.g. whether they need ' +
          'complementary products, have questions about the item, or would like ' +
          'to explore more options. Be conversational and helpful.]';
        ShopAIChat.UI.showTypingIndicator();
        ShopAIChat.API.streamResponse(followUp, conversationId, messagesContainer);
      });
      continueWrapper.appendChild(continueBtn);

      row.appendChild(viewWrapper);
      row.appendChild(continueWrapper);
      messagesContainer.appendChild(row);
      // Scroll to the action row so the user sees the cart buttons immediately.
      ShopAIChat.UI.scrollToElement(row);
    },

    /**
     * Render quick-reply chip pills below the last bot message.
     * Clicking a chip sends it as the next user message.
     * Chips are removed once one is tapped so the conversation flows cleanly.
     * @param {string[]} chips
     * @param {HTMLElement} messagesContainer
     */
    renderQuickReplies: function(chips, messagesContainer) {
      // Remove any previous reply chip row so only the latest set is visible
      messagesContainer.querySelectorAll('.shop-ai-reply-chips').forEach(function(el) {
        el.remove();
      });

      const row = document.createElement('div');
      row.classList.add('shop-ai-reply-chips');

      chips.forEach(function(chip) {
        const wrapper = document.createElement('div');
        wrapper.classList.add('shop-ai-chip-wrapper');

        // ── Send button (existing behaviour) ──────────────────────────
        const btn = document.createElement('button');
        btn.classList.add('shop-ai-reply-chip');

        const span = document.createElement('span');
        span.classList.add('shop-ai-chip-text');
        span.textContent = chip;
        btn.appendChild(span);

        btn.addEventListener('click', function() {
          messagesContainer.querySelectorAll('.shop-ai-reply-chips').forEach(function(el) {
            el.remove();
          });
          const input = document.querySelector('.shop-ai-chat-input input');
          if (input) {
            input.value = chip;
            const sendBtn = document.querySelector('.shop-ai-chat-send');
            if (sendBtn) sendBtn.click();
          }
        });

        // ── Edit button (pre-fills input, lets user modify before sending) ──
        const editBtn = document.createElement('button');
        editBtn.classList.add('shop-ai-chip-edit');
        editBtn.title = 'Edit before sending';
        editBtn.setAttribute('aria-label', 'Edit before sending');
        editBtn.innerHTML =
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
          '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' +
          '</svg>';

        editBtn.addEventListener('click', function() {
          messagesContainer.querySelectorAll('.shop-ai-reply-chips').forEach(function(el) {
            el.remove();
          });
          const input = document.querySelector('.shop-ai-chat-input input');
          if (input) {
            input.value = chip;
            input.focus();
            // Place cursor at the end so user can continue typing
            var len = input.value.length;
            input.setSelectionRange(len, len);
          }
        });

        wrapper.appendChild(btn);
        wrapper.appendChild(editBtn);
        row.appendChild(wrapper);
      });

      messagesContainer.appendChild(row);

      // Measure each chip after layout to set the scroll-offset CSS variable
      requestAnimationFrame(function() {
        row.querySelectorAll('.shop-ai-reply-chip').forEach(function(btn) {
          var span = btn.querySelector('.shop-ai-chip-text');
          if (!span) return;
          // Available text width = clientWidth minus horizontal padding (15px × 2 = 30px)
          var textArea = btn.clientWidth - 30;
          var overflow = span.scrollWidth - textArea;
          if (overflow > 2) {
            btn.style.setProperty('--chip-scroll', '-' + overflow + 'px');
            // Scale animation duration to scroll distance (min 1.4s, ~55px/s)
            var duration = Math.max(1.4, overflow / 55).toFixed(2) + 's';
            btn.style.setProperty('--chip-scroll-dur', duration);
            btn.dataset.scrollable = '1';
          }
        });
      });

      // No scroll after quick-reply chips — user is already anchored at the
      // top of the bot response and can scroll down naturally.
    },

    /**
     * Initialize the chat application
     */
    init: function() {
      const container = document.querySelector('.shop-ai-chat-container');
      if (!container) return;

      this.UI.init(container);

      const conversationId = sessionStorage.getItem('shopAiConversationId');

      // Restore pinned product before history loads so formatMessageContent
      // applies the same option-card styling as during the original session.
      // Only restore when an active conversation exists.
      if (conversationId) {
        const savedPin = sessionStorage.getItem('shopAiPinnedProduct');
        if (savedPin) {
          try {
            const restoredProduct = JSON.parse(savedPin);
            ShopAIChat.pinnedProduct = restoredProduct; // set before fetchChatHistory
            this.UI.pinProduct(restoredProduct);         // re-show the banner
          } catch(_) {
            sessionStorage.removeItem('shopAiPinnedProduct');
          }
        }
      } else {
        // No conversation means no pinned context should be visible.
        this.UI.unpinProduct();
      }

      if (conversationId) {
        // Existing conversation — hide welcome, load history
        this.UI.hideWelcome();
        this.API.fetchChatHistory(conversationId, this.UI.elements.messagesContainer);
      } else {
        // Fresh start — show the welcome screen (no old-style welcome message)
        this.UI.showWelcome();
      }
    }
  };

  // Initialize the application when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    ShopAIChat.init();
  });
})();
