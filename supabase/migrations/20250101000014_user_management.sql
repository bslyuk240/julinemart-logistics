-- Step 1: Create users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'viewer')),
  is_active boolean DEFAULT true,
  last_login timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Step 2: Create roles table
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  display_name text NOT NULL,
  description text,
  permissions jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now()
);

-- Step 3: Create activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text,
  resource_id uuid,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone DEFAULT now()
);

-- Step 4: Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  display_name text NOT NULL,
  description text,
  resource text NOT NULL,
  actions text[] NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);

-- Step 5: Insert default roles
INSERT INTO roles (name, display_name, description, permissions) VALUES
('admin', 'Administrator', 'Full system access with all permissions', 
  '["users.create", "users.read", "users.update", "users.delete", "orders.create", "orders.read", "orders.update", "orders.delete", "hubs.create", "hubs.read", "hubs.update", "hubs.delete", "couriers.create", "couriers.read", "couriers.update", "couriers.delete", "rates.create", "rates.read", "rates.update", "rates.delete", "analytics.read", "logs.read"]'::jsonb),
('manager', 'Manager', 'Manage orders, hubs, and view analytics', 
  '["orders.create", "orders.read", "orders.update", "hubs.read", "hubs.update", "couriers.read", "rates.read", "rates.update", "analytics.read"]'::jsonb),
('viewer', 'Viewer', 'Read-only access to orders and analytics', 
  '["orders.read", "hubs.read", "couriers.read", "rates.read", "analytics.read"]'::jsonb)
ON CONFLICT (name) DO UPDATE 
SET permissions = EXCLUDED.permissions;

-- Step 6: Insert default permissions
INSERT INTO permissions (name, display_name, description, resource, actions) VALUES
('users.manage', 'Manage Users', 'Create, edit, and delete users', 'users', ARRAY['create', 'read', 'update', 'delete']),
('orders.manage', 'Manage Orders', 'Create, edit, and manage orders', 'orders', ARRAY['create', 'read', 'update', 'delete']),
('hubs.manage', 'Manage Hubs', 'Create and edit delivery hubs', 'hubs', ARRAY['create', 'read', 'update', 'delete']),
('couriers.manage', 'Manage Couriers', 'Create and edit courier partners', 'couriers', ARRAY['create', 'read', 'update', 'delete']),
('rates.manage', 'Manage Shipping Rates', 'Create and edit shipping rates', 'rates', ARRAY['create', 'read', 'update', 'delete']),
('analytics.view', 'View Analytics', 'Access analytics and reports', 'analytics', ARRAY['read']),
('logs.view', 'View Activity Logs', 'View system activity logs', 'logs', ARRAY['read'])
ON CONFLICT (name) DO NOTHING;

-- Step 7: Create function to automatically log activities
CREATE OR REPLACE FUNCTION log_activity()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO activity_logs (user_id, action, resource_type, resource_id, details)
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    jsonb_build_object(
      'old', to_jsonb(OLD),
      'new', to_jsonb(NEW)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 8: Create triggers for activity logging on key tables
DROP TRIGGER IF EXISTS log_orders_activity ON orders;
CREATE TRIGGER log_orders_activity
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION log_activity();

DROP TRIGGER IF EXISTS log_hubs_activity ON hubs;
CREATE TRIGGER log_hubs_activity
  AFTER INSERT OR UPDATE OR DELETE ON hubs
  FOR EACH ROW EXECUTE FUNCTION log_activity();

DROP TRIGGER IF EXISTS log_couriers_activity ON couriers;
CREATE TRIGGER log_couriers_activity
  AFTER INSERT OR UPDATE OR DELETE ON couriers
  FOR EACH ROW EXECUTE FUNCTION log_activity();

DROP TRIGGER IF EXISTS log_shipping_rates_activity ON shipping_rates;
CREATE TRIGGER log_shipping_rates_activity
  AFTER INSERT OR UPDATE OR DELETE ON shipping_rates
  FOR EACH ROW EXECUTE FUNCTION log_activity();

-- Step 9: Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Step 10: Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

-- Step 11: Create RLS policies
-- Users can read their own data
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (auth.uid() = id);

-- Admins can view all users
CREATE POLICY "Admins can view all users" ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can insert users
CREATE POLICY "Admins can insert users" ON users
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can update users
CREATE POLICY "Admins can update users" ON users
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Users can view activity logs based on role
CREATE POLICY "Users can view activity logs" ON activity_logs
  FOR SELECT USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Everyone can read roles (for role selection)
CREATE POLICY "Everyone can read roles" ON roles
  FOR SELECT USING (true);

-- Everyone can read permissions (for permission display)
CREATE POLICY "Everyone can read permissions" ON permissions
  FOR SELECT USING (true);

-- Step 12: Create summary view
CREATE OR REPLACE VIEW user_summary AS
SELECT 
  u.id,
  u.email,
  u.full_name,
  u.role,
  r.display_name as role_display_name,
  u.is_active,
  u.last_login,
  u.created_at,
  (SELECT COUNT(*) FROM activity_logs WHERE user_id = u.id) as activity_count,
  (SELECT MAX(created_at) FROM activity_logs WHERE user_id = u.id) as last_activity
FROM users u
LEFT JOIN roles r ON r.name = u.role;

-- Success message
SELECT 'User management system created successfully!' as status;

-- Show summary
SELECT 'Roles' as entity, COUNT(*) as count FROM roles
UNION ALL
SELECT 'Permissions', COUNT(*) FROM permissions
UNION ALL
SELECT 'Users', COUNT(*) FROM users;
