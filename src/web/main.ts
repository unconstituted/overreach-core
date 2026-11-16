import './ui.css';
import { ENGINE_NAME, ENGINE_VERSION } from '../core/version';

const app = document.getElementById('app');
if (app) {
  app.innerHTML = `<div class="wrap"><h1>${ENGINE_NAME} ${ENGINE_VERSION}</h1>
    <p class="dim">The ride view arrives in Stage 5. For now: <a href="./devices.html">device test page</a>.</p></div>`;
}
