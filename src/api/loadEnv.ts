// Load .env then .env.local (override) so local secrets match Vite.
//
// This must be its own module and the FIRST import in index.ts. ES modules
// evaluate every import's module tree (in source order, depth-first) before
// the importing file's own top-level statements run — so a plain
// `dotenv.config()` call sitting in index.ts, even textually before its
// other imports, still runs *after* those imports (and anything they
// transitively import, e.g. a service file that calls createClient() at
// module scope) have already been evaluated. That's what crashed the API
// server on startup: shippingCalculator.ts read process.env.VITE_SUPABASE_URL
// before dotenv had populated it. Isolating the dotenv calls in a module with
// no other imports, placed first, sidesteps the hoisting order entirely.
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });
