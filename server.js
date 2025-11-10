import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "@supabase/supabase-js";

dotenv.config();
const { createClient } = pkg;

// Supabase connection
const supabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors());
app.use(express.json());

// 🧭 Root check
app.get("/", (req, res) => {
  res.send("✅ JulineMart Logistics API is running!");
});

// 🏢 Get all hubs
app.get("/api/hubs", async (req, res) => {
  const { data, error } = await supabase.from("hubs").select("*");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 🚚 Get all couriers
app.get("/api/couriers", async (req, res) => {
  const { data, error } = await supabase.from("couriers").select("*");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 💰 Get all shipping rates
app.get("/api/shipping/rates", async (req, res) => {
  const { data, error } = await supabase.from("shipping_rates").select("*");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 🧮 Calculate shipping cost
app.post("/api/shipping/calculate", async (req, res) => {
  const { hub_id, zone_id, weight } = req.body;
  if (!hub_id || !zone_id || !weight)
    return res.status(400).json({ error: "Missing required parameters" });

  const { data, error } = await supabase
    .from("shipping_rates")
    .select("*")
    .eq("hub_id", hub_id)
    .eq("zone_id", zone_id)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Rate not found" });

  const totalCost =
    parseFloat(data.flat_rate || 0) +
    parseFloat(data.per_kg_rate || 0) * parseFloat(weight || 1);

  res.json({
    hub_id,
    zone_id,
    weight,
    flat_rate: data.flat_rate,
    per_kg_rate: data.per_kg_rate,
    total_cost: totalCost,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Logistics API running on port ${PORT}`));
