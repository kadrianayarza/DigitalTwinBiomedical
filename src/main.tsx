import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import App from './App.tsx';
import { DbConnection, ErrorContext } from './module_bindings/index.ts';
import { currentRole, tokenKey } from './lib/role.ts';
import { initTheme } from './lib/theme.ts';
import '@fontsource-variable/google-sans-flex/standard.css';
import '@fontsource-variable/google-sans-code';
import '@fontsource/poiret-one';
import '@fontsource-variable/open-sans';
import './styles.css';

initTheme();

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://127.0.0.1:3100';
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'twincare';
const TOKEN_KEY = tokenKey(currentRole());

const connectionBuilder = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(localStorage.getItem(TOKEN_KEY) || undefined)
  .onConnect((_conn, _identity, token) => localStorage.setItem(TOKEN_KEY, token))
  .onConnectError((_ctx: ErrorContext, err: Error) =>
    console.error('Error connecting to SpacetimeDB:', err)
  );

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>
);
