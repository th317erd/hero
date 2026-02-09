'use strict';

/**
 * Hero Components Entry Point
 *
 * Imports and registers all Hero web components.
 * Include this module to enable component-based UI.
 */

// Core infrastructure
export { GlobalState, HeroComponent, DynamicProperty, Utils } from './hero-base.js';

// Expose GlobalState globally for legacy scripts
import { GlobalState as GS, DynamicProperty as DP } from './hero-base.js';

// Application shell
export { HeroApp, parseRoute } from './hero-app.js';

// Layout components
export { HeroHeader } from './hero-header.js';
export { HeroSidebar } from './hero-sidebar.js';
export { HeroStatusBar } from './hero-status-bar.js';
export { HeroMainControls } from './hero-main-controls.js';

// Chat components
export { HeroChat } from './hero-chat.js';
export { HeroInput } from './hero-input.js';

// Services
export { HeroWebSocket } from './hero-websocket.js';

// Modals
export {
  HeroModal,
  HeroModalSession,
  HeroModalAgent,
  HeroModalAbility,
  HeroModalAbilities,
  HeroModalAgents,
  HeroModalAgentConfig,
} from './hero-modal.js?v=5';

// One-time initialization
if (!window.__heroComponentsLoaded) {
  window.__heroComponentsLoaded = true;
  window.GlobalState = GS;
  window.DynamicProperty = DP;

  /**
   * Helper to set GlobalState values from legacy scripts.
   * @param {string} key - GlobalState key (e.g., 'sessions')
   * @param {*} value - New value
   */
  window.setGlobal = (key, value) => {
    if (GS[key]) {
      GS[key][DP.set](value);
    } else {
      console.warn(`GlobalState.${key} does not exist`);
    }
  };

  console.log('[Hero] Components registered:', [
    'hero-app',
    'hero-header',
    'hero-sidebar',
    'hero-status-bar',
    'hero-main-controls',
    'hero-chat',
    'hero-input',
    'hero-websocket',
    'hero-modal',
    'hero-modal-session',
    'hero-modal-agent',
    'hero-modal-ability',
    'hero-modal-abilities',
    'hero-modal-agents',
    'hero-modal-agent-config',
  ].join(', '));
}
