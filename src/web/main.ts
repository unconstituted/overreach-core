import { ENGINE_NAME, ENGINE_VERSION } from '../core/version';

const app = document.getElementById('app');
if (app) app.textContent = `${ENGINE_NAME} ${ENGINE_VERSION}`;
