import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log('🔍 Testing Supabase Connection...\n');
console.log('URL:', supabaseUrl);
console.log('Key:', supabaseKey ? '✅ Set (' + supabaseKey.substring(0, 20) + '...)' : '❌ Missing');

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    console.log('\n📊 Testing: Fetching zones...');
    const { data, error } = await supabase
      .from('zones')
      .select('*');
    
    if (error) {
      console.error('❌ Database Error:', error);
      process.exit(1);
    }
    
    console.log(`✅ Success! Found ${data?.length} zones:`);
    data?.forEach(zone => {
      console.log(`  • ${zone.name} (${zone.code}) - ${zone.states.join(', ')}`);
    });
    
    console.log('\n📊 Testing: Fetching shipping rates...');
    const { data: rates, error: ratesError } = await supabase
      .from('shipping_rates')
      .select('*, zones(name)');
    
    if (ratesError) {
      console.error('❌ Rates Error:', ratesError);
    } else {
      console.log(`✅ Found ${rates?.length} shipping rates`);
    }
    
    console.log('\n🎉 Database connection is working perfectly!');
  } catch (err) {
    console.error('❌ Connection failed:', err);
    process.exit(1);
  }
}

testConnection();
