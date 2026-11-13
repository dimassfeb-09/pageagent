import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../sidepanel/App';
import sidepanelCss from '../sidepanel/index.css?inline';
import chatspaceCss from '../sidepanel/chatspace.css?inline';

(() => {
  // Start with the sidebar collapsed so the chat area has room in the narrow panel.
  try { window.localStorage.setItem('pageagent.sidebarCollapsed', 'true'); } catch { /* ignore */ }
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:0;right:0;bottom:0;width:480px;max-width:90vw;z-index:2147483646;pointer-events:none;display:none;background:#ffffff;box-shadow:-2px 0 24px rgba(0,0,0,.18);';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = sidepanelCss + '\n' + chatspaceCss + '\n:host{all:initial;}';  shadow.appendChild(style);

  const toggle = document.createElement('button');
  toggle.textContent = 'P';
  toggle.title = 'Toggle PageAgent';
  toggle.style.cssText = 'pointer-events:auto;position:fixed;bottom:16px;right:16px;width:44px;height:44px;border-radius:50%;border:none;background:#47885a;color:#fff;font:600 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2147483646;';
  document.body.appendChild(toggle);

  const container = document.createElement('div');
  container.id = 'root';
  container.style.cssText = 'width:100%;height:100%;pointer-events:auto;background:#ffffff;overflow:hidden;';
  shadow.appendChild(container);

  let root: Root | null = null;
  let visible = false;
  const setVisible = (next: boolean) => {
    visible = next;
    host.style.display = visible ? 'block' : 'none';
    toggle.style.display = visible ? 'none' : 'flex';
    if (visible && !root) {
      root = createRoot(container);
      root.render(React.createElement(App));
    }
  };
  toggle.addEventListener('click', () => setVisible(true));

  // Close on Escape.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && visible) setVisible(false); }, true);
})();