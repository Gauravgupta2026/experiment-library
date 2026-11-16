import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import './styles/tokens.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { APP_NAME } from './config';

document.title = APP_NAME;
const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
