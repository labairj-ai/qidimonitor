import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import configRouter from './routes/config.js';
import printerRouter from './routes/printer.js';
import diagnoseRouter from './routes/diagnose.js';
import filesRouter from './routes/files.js';
import slicerRouter from './routes/slicer.js';
import { printersRouter, printerScope } from './printers.js';
import { createMonitor } from './monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4200;
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

const app = express();
app.use(express.json());

export const api = express.Router();
api.use('/config', configRouter);
api.use('/printer', printerRouter);
api.use('/', diagnoseRouter);
api.use('/files', filesRouter);
api.use('/slicer', slicerRouter);
app.use('/api/printers', printersRouter);
app.use('/api/printers/:printerId', printerScope, api);
// Compatibility for existing QIDI bookmarks; never a mutable active-printer target.
app.use('/api', (req, _res, next) => { req.printerId = 'qidi'; next(); }, api);

// Serve React SPA in production
app.use(express.static(CLIENT_DIST, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-store');
  },
}));
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

function listen(retries = 5) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`qidimonitor running on port ${PORT}`);
    startAutoMonitor();
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && retries > 0) {
      console.log(`Port ${PORT} in use, retrying in 2s (${retries} attempts left)…`);
      setTimeout(() => listen(retries - 1), 2000);
    } else {
      console.error('Failed to bind port:', e.message);
      process.exit(1);
    }
  });
}
listen();

// Each printer has an independent schedule and overlap guard.
function startAutoMonitor() {
  const tick = createMonitor();
  setInterval(tick, 60000);
}
