import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { calcShippingHandler, getZoneHandler } from './routes/shipping.js';
import { getOrdersHandler, getOrderByIdHandler, createOrderHandler, updateOrderStatusHandler, deleteOrderHandler } from './routes/orders.js';
import { getTrackingHandler, updateTrackingHandler } from './routes/tracking.js';
import { getHubsHandler, createHubHandler, updateHubHandler, deleteHubHandler, getCouriersHandler, getZonesWithRatesHandler, getDashboardStatsHandler, createCourierHandler, updateCourierHandler, deleteCourierHandler } from './routes/admin.js';
import { getShippingRatesHandler, getShippingRateByIdHandler, createShippingRateHandler, updateShippingRateHandler, deleteShippingRateHandler } from './routes/shippingRates.js';
import { authenticate, requireRole } from './middleware/auth.js';
import { paystackRefundHandler, getPaystackRefundStatus } from './routes/paystackRefund.js';
import { 
  getUsersHandler, 
  getUserByIdHandler, 
  createUserHandler, 
  updateUserHandler, 
  deleteUserHandler,
  getRolesHandler,
  getActivityLogsHandler,
  getCurrentUserHandler
} from './routes/users.js';
import { 
  createCourierShipmentHandler, 
  getCourierTrackingHandler, 
  generateLabelHandler,
  updateCourierCredentialsHandler,
  getCourierAPILogsHandler
} from './routes/courierOperations.js';
import {
  getPendingPaymentsHandler,
  getSettlementsHandler,
  createSettlementHandler,
  markSettlementPaidHandler,
  getSettlementDetailsHandler,
  getCourierPaymentStatsHandler
} from './routes/settlements.js';
import {
  trackOrderPublicHandler,
  getShippingEstimatePublicHandler
} from './routes/publicTracking.js';
import {
  getEmailConfigHandler,
  saveEmailConfigHandler,
  testEmailConnectionHandler,
  getEmailTemplatesHandler,
  getEmailTemplateHandler,
  updateEmailTemplateHandler,
  previewEmailTemplateHandler
} from './routes/emailConfig.js';
import { sendTestEmail } from './services/emailService.js';

console.log('🚀 Starting JLO API Server...');
console.log('📋 Environment Check:');
console.log('  - VITE_SUPABASE_URL:', process.env.VITE_SUPABASE_URL ? '✅ Set' : '❌ Missing');
console.log('  - SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  void res; // avoid TS unused param warning
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    supabaseConfigured: !!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root route
app.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'JulineMart Logistics Orchestrator API',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      root: 'GET /',
      // Shipping
      shipping: 'POST /api/calc-shipping',
      zones: 'GET /api/zones/:state',
      // Orders
      orders: 'GET /api/orders',
      createOrder: 'POST /api/orders',
      orderById: 'GET /api/orders/:id',
      // Tracking
      tracking: 'GET /api/tracking/:id',
      // Admin
      hubs: 'GET /api/hubs',
      couriers: 'GET /api/couriers',
      stats: 'GET /api/stats',
      // Shipping Rates
      shippingRates: 'GET /api/shipping-rates',
      // User Management
      currentUser: 'GET /api/me (authenticated)',
      users: 'GET /api/users (admin only)',
      roles: 'GET /api/roles (authenticated)',
      activityLogs: 'GET /api/activity-logs (admin only)',
      // Refunds
      refundsPaystack: 'POST /api/refunds/paystack (admin/agent)',
      refundStatus: 'GET /api/refunds/paystack/:reference (admin/agent)'
    },
    documentation: 'See README.md for API documentation'
  });
});

// Shipping routes (public)
app.post('/api/calc-shipping', calcShippingHandler);
app.get('/api/zones/:state', getZoneHandler);
console.log('📦 Shipping routes registered');

// Webhook routes (public)
console.log('🔗 Webhook routes registered');

// Orders routes (restricted: admin or agent)
app.get('/api/orders', authenticate, requireRole('admin', 'agent'), getOrdersHandler);
app.post('/api/orders', authenticate, requireRole('admin', 'agent'), createOrderHandler);
app.get('/api/orders/:id', authenticate, requireRole('admin', 'agent'), getOrderByIdHandler);
app.put('/api/orders/:id/status', authenticate, requireRole('admin', 'agent'), updateOrderStatusHandler);
app.delete('/api/orders/:id', authenticate, requireRole('admin', 'agent'), deleteOrderHandler);
console.log('📋 Orders routes registered');

// Tracking routes (public for now)
app.get('/api/tracking/:id', getTrackingHandler);
app.post('/api/tracking/:subOrderId', updateTrackingHandler);
console.log('🔍 Tracking routes registered');

// Admin-only routes
app.get('/api/hubs', authenticate, requireRole('admin'), getHubsHandler);
app.post('/api/hubs', authenticate, requireRole('admin'), createHubHandler);
app.put('/api/hubs/:id', authenticate, requireRole('admin'), updateHubHandler);
app.delete('/api/hubs/:id', authenticate, requireRole('admin'), deleteHubHandler);
app.get('/api/couriers', authenticate, requireRole('admin'), getCouriersHandler);
app.post('/api/couriers', authenticate, requireRole('admin'), createCourierHandler);
app.put('/api/couriers/:id', authenticate, requireRole('admin'), updateCourierHandler);
app.delete('/api/couriers/:id', authenticate, requireRole('admin'), deleteCourierHandler);
app.get('/api/zones', authenticate, requireRole('admin'), getZonesWithRatesHandler);
app.get('/api/stats', authenticate, requireRole('admin', 'agent'), getDashboardStatsHandler);
console.log('⚙️ Admin routes registered');

// Shipping Rates routes (admin or agent)
app.get('/api/shipping-rates', authenticate, requireRole('admin', 'agent'), getShippingRatesHandler);
app.get('/api/shipping-rates/:id', authenticate, requireRole('admin', 'agent'), getShippingRateByIdHandler);
app.post('/api/shipping-rates', authenticate, requireRole('admin', 'agent'), createShippingRateHandler);
app.put('/api/shipping-rates/:id', authenticate, requireRole('admin', 'agent'), updateShippingRateHandler);
app.delete('/api/shipping-rates/:id', authenticate, requireRole('admin', 'agent'), deleteShippingRateHandler);
console.log('💵 Shipping rates routes registered');

// User Management routes (protected with authentication)
app.get('/api/me', authenticate, getCurrentUserHandler);
app.get('/api/users', authenticate, requireRole('admin'), getUsersHandler);
app.get('/api/users/:id', authenticate, requireRole('admin', 'manager'), getUserByIdHandler);
app.post('/api/users', authenticate, requireRole('admin'), createUserHandler);
app.put('/api/users/:id', authenticate, requireRole('admin'), updateUserHandler);
app.delete('/api/users/:id', authenticate, requireRole('admin'), deleteUserHandler);

// Roles routes (accessible to authenticated users)
// Make roles public so the dashboard role dropdown works without a token
app.get('/api/roles', getRolesHandler);

// Activity logs routes (admin and manager only)
app.get('/api/activity-logs', authenticate, requireRole('admin'), getActivityLogsHandler);

console.log('👥 User management routes registered');

// Courier Integration routes
app.post('/api/courier/create-shipment', createCourierShipmentHandler);
app.get('/api/courier/tracking/:subOrderId', getCourierTrackingHandler);
app.get('/api/courier/label/:subOrderId', generateLabelHandler);
app.put('/api/couriers/:courierId/credentials', updateCourierCredentialsHandler);
app.get('/api/courier/logs', getCourierAPILogsHandler);

console.log('🚚 Courier integration routes registered');

// Settlement routes
app.get('/api/settlements/pending', getPendingPaymentsHandler);
app.get('/api/settlements', getSettlementsHandler);
app.post('/api/settlements', createSettlementHandler);
app.put('/api/settlements/:id/mark-paid', markSettlementPaidHandler);
app.get('/api/settlements/:id', getSettlementDetailsHandler);
app.get('/api/settlements/stats/:courier_id?', getCourierPaymentStatsHandler);

console.log('💳 Settlement routes registered');

// Public tracking routes (no auth required)
app.get('/api/track-order', trackOrderPublicHandler);
app.post('/api/shipping-estimate', getShippingEstimatePublicHandler);

console.log('🌐 Public tracking routes registered');

// Email configuration and templates routes
app.get('/api/email/config', getEmailConfigHandler);
app.post('/api/email/config', saveEmailConfigHandler);
app.post('/api/email/test-connection', testEmailConnectionHandler);
app.get('/api/email/templates', getEmailTemplatesHandler);
app.get('/api/email/templates/:id', getEmailTemplateHandler);
app.put('/api/email/templates/:id', updateEmailTemplateHandler);
app.post('/api/email/templates/:id/preview', previewEmailTemplateHandler);
app.post('/api/emails/test', async (req: Request, res: Response) => {
  try {
    const { to } = req.body as { to?: string };
    if (!to) {
      return res.status(400).json({ success: false, error: 'Missing recipient email (to)' });
    }
    const ok = await sendTestEmail(to);
    return res.status(ok ? 200 : 500).json({ success: ok, message: ok ? 'Test email sent' : 'Failed to send test email' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to send test email' });
  }
});

console.log('✉️  Email routes registered');

// Refund routes (admin or agent)
app.post('/api/refunds/paystack', authenticate, requireRole('admin', 'agent'), paystackRefundHandler);
app.get('/api/refunds/paystack/:reference', authenticate, requireRole('admin', 'agent'), getPaystackRefundStatus);

console.log('💰 Refund routes registered');

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    hint: 'Visit / for available endpoints'
  });
});

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  void _next; // keep 4-arg signature for Express error handler
  console.error('❌ Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: (err instanceof Error ? err.message : 'Unknown error'),
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log('\n-------------------------------------------------------');
  console.log('🚀 JLO API Server Started Successfully!');
  console.log('-------------------------------------------------------');
  console.log(`🌐 Server URL: http://localhost:${PORT}`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
  console.log(`📖 Endpoints: http://localhost:${PORT}/`);
  console.log(`🔗 Supabase: ${process.env.VITE_SUPABASE_URL || 'NOT SET'}`);
  console.log('-------------------------------------------------------\n');
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use!`);
  } else {
    console.error('❌ Server error:', error);
  }
  process.exit(1);
});

export default app;