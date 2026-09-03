import express from 'express';
import cors from 'cors';
import routes from './routes';
import { requestLogger } from '../middleware/requestLogger';
import { errorHandler } from '../middleware/errorHandler';
import { registerPaymentHandlers } from '../ingestion/eventHandlers/paymentEventHandler';
import { registerRecoveryHandlers } from '../ingestion/eventHandlers/recoveryEventHandler';

// Bootstrap internal modular event handlers
registerPaymentHandlers();
registerRecoveryHandlers();

const app = express();

// Enable Cross-Origin Resource Sharing (CORS) for decoupled Vercel frontend & external clients
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-merchant-id', 'Accept']
}));

// Enable request bodies parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

import path from 'path';

// Apply structured request logger middleware
app.use(requestLogger);

import fs from 'fs';

// Serve static frontend assets from public directory
const publicDir = fs.existsSync(path.join(process.cwd(), 'public'))
  ? path.join(process.cwd(), 'public')
  : path.join(__dirname, '../../../public');

app.use(express.static(publicDir));

// Customer portal static page route: /customer-portal
app.get('/customer-portal', (_req, res) => {
  res.sendFile(path.join(publicDir, 'customer.html'));
});

// Bind base API routing
app.use(routes);

// Single Page Application Fallback for browser navigation
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/merchant') || req.path.startsWith('/api/merchant') || 
      req.path.startsWith('/customer') || req.path.startsWith('/api/customer') || 
      req.path.startsWith('/demo') || req.path.startsWith('/api/demo') || 
      req.path.startsWith('/webhooks') || req.path.startsWith('/api/webhooks') || 
      req.path === '/health') {
    return next();
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Register central express error interceptor
app.use(errorHandler);

export default app;
