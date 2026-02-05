'use strict';

// ============================================================================
// Routing
// ============================================================================

function getRoute() {
  let path = window.location.pathname;

  // Strip base path
  if (path.startsWith(BASE_PATH))
    path = path.slice(BASE_PATH.length) || '/';

  if (path === '/login')
    return { view: 'login' };

  if (path === '/' || path === '')
    return { view: 'sessions' };

  let sessionMatch = path.match(/^\/sessions\/(\d+)$/);

  if (sessionMatch)
    return { view: 'chat', sessionId: parseInt(sessionMatch[1], 10) };

  // Unknown route, default to sessions
  return { view: 'sessions' };
}

function navigate(path) {
  window.history.pushState({}, '', BASE_PATH + path);
  handleRoute();
}

async function handleRoute() {
  let route = getRoute();

  // Check auth for non-login routes
  if (route.view !== 'login') {
    try {
      let me     = await fetchMe();
      state.user = me;
      connectWebSocket();
    } catch (error) {
      // Not authenticated, show login
      disconnectWebSocket();
      showView('login');
      return;
    }
  }

  switch (route.view) {
    case 'login':
      disconnectWebSocket();
      showView('login');
      break;

    case 'sessions':
      await loadSessions();
      showView('sessions');
      break;

    case 'chat':
      await loadSession(route.sessionId);
      showView('chat');
      break;

    default:
      showView('sessions');
  }
}

// ============================================================================
// Views
// ============================================================================

function showView(viewName) {
  elements.loginView.style.display    = (viewName === 'login') ? 'flex' : 'none';
  elements.sessionsView.style.display = (viewName === 'sessions') ? 'flex' : 'none';
  elements.chatView.style.display     = (viewName === 'chat') ? 'flex' : 'none';
}
