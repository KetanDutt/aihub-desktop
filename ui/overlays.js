/**
 * Lightweight overlay components: toasts, confirmations and context menus.
 *
 * Replaces the native `alert()` / `confirm()` calls, which are blocking,
 * unstyled and impossible to theme.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const TOAST_TIMEOUT_MS = 3400;

  // Toast type -> icon name in the shared icon family (see icons.js).
  const TOAST_ICONS = {
    info: 'info',
    success: 'success',
    warning: 'warning',
    error: 'error'
  };

  function toastRoot() {
    return document.getElementById('toast-root') || document.body;
  }

  /**
   * Non-blocking notification.
   *
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} [type]
   * @param {{action?: {label: string, onClick: Function}, timeout?: number}} [options]
   *   `action` adds a button ("Reload", "Retry", …) and keeps the toast up
   *   longer, because something with a button is worth acting on.
   * @returns {HTMLElement} the toast element
   */
  app.toast = function toast(message, type = 'info', options = {}) {
    const { action = null, timeout = null } = options || {};
    const root = toastRoot();
    const el = document.createElement('div');
    el.className = `toast toast-${type}${action ? ' toast-has-action' : ''}`;
    el.setAttribute('role', 'status');

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.appendChild(app.icon(TOAST_ICONS[type] || TOAST_ICONS.info, 14));

    const body = document.createElement('span');
    body.className = 'toast-body';
    body.textContent = message;

    el.append(icon, body);

    const remove = () => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 220);
    };

    let timer = null;
    const dismiss = () => {
      if (timer) clearTimeout(timer);
      remove();
    };

    if (action && typeof action.onClick === 'function') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.textContent = String(action.label || 'Do it');
      // The button is the only interactive part: clicking it must not also
      // trigger the click-anywhere-to-dismiss handler on the card.
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        dismiss();
        try {
          action.onClick();
        } catch (error) {
          /* the action owns its own errors */
        }
      });
      el.appendChild(button);
    }

    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));

    const lifetime = Number.isFinite(timeout) ? timeout : action ? TOAST_TIMEOUT_MS * 2.6 : TOAST_TIMEOUT_MS;
    timer = setTimeout(remove, lifetime);
    el.addEventListener('click', dismiss);
    return el;
  };

  /**
   * Themed confirmation dialog.
   * @param {{title: string, message: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean}} options
   * @returns {Promise<boolean>}
   */
  app.confirm = function confirm(options) {
    const {
      title = 'Are you sure?',
      message = '',
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      danger = false
    } = options || {};

    return new Promise((resolve) => {
      const root = document.getElementById('overlay-root') || document.body;

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';

      const dialog = document.createElement('div');
      dialog.className = 'modal';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      const heading = document.createElement('h3');
      heading.textContent = title;

      const body = document.createElement('p');
      body.className = 'modal-message';
      body.textContent = message;

      const actions = document.createElement('div');
      actions.className = 'modal-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = cancelLabel;

      const confirmBtn = document.createElement('button');
      confirmBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
      confirmBtn.textContent = confirmLabel;

      actions.append(cancelBtn, confirmBtn);
      dialog.append(heading, body, actions);
      backdrop.appendChild(dialog);
      root.appendChild(backdrop);

      const finish = (result) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.classList.remove('visible');
        setTimeout(() => {
          backdrop.remove();
          resolve(result);
        }, 180);
      };

      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          finish(false);
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        }
      };

      cancelBtn.addEventListener('click', () => finish(false));
      confirmBtn.addEventListener('click', () => finish(true));
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) finish(false);
      });
      document.addEventListener('keydown', onKey, true);

      requestAnimationFrame(() => backdrop.classList.add('visible'));
      confirmBtn.focus();
    });
  };

  /**
   * Custom context menu.
   * @param {number} x client X
   * @param {number} y client Y
   * @param {Array<{label?: string, type?: 'separator'|'header', danger?: boolean, disabled?: boolean, onClick?: Function}>} items
   */
  app.contextMenu = function contextMenu(x, y, items) {
    app.closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');

    for (const item of items) {
      if (!item) continue;

      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'context-separator';
        menu.appendChild(sep);
        continue;
      }

      if (item.type === 'header') {
        const header = document.createElement('div');
        header.className = 'context-header';
        header.textContent = item.label;
        menu.appendChild(header);
        continue;
      }

      const button = document.createElement('button');
      button.className = 'context-item';
      if (item.danger) button.classList.add('danger');
      if (item.disabled) button.disabled = true;
      button.setAttribute('role', 'menuitem');
      button.textContent = item.label;
      button.addEventListener('click', () => {
        app.closeContextMenu();
        if (typeof item.onClick === 'function') item.onClick();
      });
      menu.appendChild(button);
    }

    document.body.appendChild(menu);

    // Keep the menu inside the viewport.
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    menu.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, maxY))}px`;

    app._contextMenu = menu;

    const dismiss = (event) => {
      if (menu.contains(event.target)) return;
      app.closeContextMenu();
    };

    const onKey = (event) => {
      if (event.key === 'Escape') app.closeContextMenu();
    };

    setTimeout(() => {
      document.addEventListener('mousedown', dismiss, { once: true });
      document.addEventListener('keydown', onKey);
      window.addEventListener('blur', () => app.closeContextMenu(), { once: true });
      app._contextMenuKeyHandler = onKey;
    }, 0);

    return menu;
  };

  app.closeContextMenu = function closeContextMenu() {
    if (app._contextMenuKeyHandler) {
      document.removeEventListener('keydown', app._contextMenuKeyHandler);
      app._contextMenuKeyHandler = null;
    }
    if (app._contextMenu) {
      app._contextMenu.remove();
      app._contextMenu = null;
    }
  };
})(window.AiHub);
