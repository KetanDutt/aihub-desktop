/**
 * Lightweight overlay components: toasts, confirmations and context menus.
 *
 * Replaces the native `alert()` / `confirm()` calls, which are blocking,
 * unstyled and impossible to theme.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const TOAST_TIMEOUT_MS = 3200;

  function toastRoot() {
    return document.getElementById('toast-root') || document.body;
  }

  /**
   * Non-blocking notification.
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} [type]
   */
  app.toast = function toast(message, type = 'info') {
    const root = toastRoot();
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    root.appendChild(el);

    requestAnimationFrame(() => el.classList.add('visible'));

    const remove = () => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 200);
    };

    const timer = setTimeout(remove, TOAST_TIMEOUT_MS);
    el.addEventListener('click', () => {
      clearTimeout(timer);
      remove();
    });
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
        backdrop.remove();
        resolve(result);
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

    setTimeout(() => {
      document.addEventListener('mousedown', dismiss, { once: true });
      document.addEventListener('keydown', function onKey(event) {
        if (event.key === 'Escape') app.closeContextMenu();
      });
      window.addEventListener('blur', () => app.closeContextMenu(), { once: true });
    }, 0);

    return menu;
  };

  app.closeContextMenu = function closeContextMenu() {
    if (app._contextMenu) {
      app._contextMenu.remove();
      app._contextMenu = null;
    }
  };
})(window.AiHub);
