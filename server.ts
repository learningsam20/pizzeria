import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = 3000;
const KM_FILE_PATH = path.join(process.cwd(), "km.txt");

// In-memory store for fallback data (when Supabase is not connected yet)
// This ensures that even in local-only demo mode, order status and menu items can be resolved by the chatbot!
let mockOrdersStore: any[] = [];
let mockMenuItemsStore: any[] = [];

// Helper to load or initialize mock stores for the chatbot fallback
const getLocalData = () => {
  try {
    const ordersFile = path.join(process.cwd(), "mock_orders.json");
    if (fs.existsSync(ordersFile)) {
      mockOrdersStore = JSON.parse(fs.readFileSync(ordersFile, "utf-8"));
    }
  } catch (e) {
    console.warn("Could not read mock_orders.json:", e);
  }
};

// Start server function
async function startServer() {
  // 1. Endpoints
  
  // Endpoint to return keys securely
  app.get("/api/config", (req, res) => {
    res.json({
      supabaseUrl: process.env.SUPABASE_URL || null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
      hasGemini: !!process.env.GEMINI_API_KEY,
    });
  });

  // KB Status
  app.get("/api/km-status", (req, res) => {
    try {
      if (fs.existsSync(KM_FILE_PATH)) {
        const stats = fs.statSync(KM_FILE_PATH);
        const content = fs.readFileSync(KM_FILE_PATH, "utf-8");
        res.json({
          exists: true,
          sizeBytes: stats.size,
          updatedAt: stats.mtime.toISOString(),
          snippet: content.slice(0, 300) + (content.length > 300 ? "..." : ""),
        });
      } else {
        res.json({
          exists: false,
          sizeBytes: 0,
          updatedAt: null,
          snippet: "No knowledge base uploaded yet. Default guidelines will be used.",
        });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // KB Upload
  app.post("/api/km-upload", (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Invalid text data received" });
      }
      fs.writeFileSync(KM_FILE_PATH, text, "utf-8");
      res.json({ success: true, message: "km.txt saved successfully!" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Chat API using Gemini
  app.post("/api/chat", async (req, res) => {
    const { message, history, contextOrderId, contextOrderPhone, currentOrders, currentMenuItems } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(200).json({
        text: "⚠️ Gemini API Key is missing! Please configure GEMINI_API_KEY in the Settings > Secrets panel of Google AI Studio.",
      });
    }

    try {
      // 1. Initialize Gemini client
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      // 2. Load km.txt Knowledge Base
      let kmContent = "";
      if (fs.existsSync(KM_FILE_PATH)) {
        try {
          kmContent = fs.readFileSync(KM_FILE_PATH, "utf-8");
        } catch (err) {
          console.error("Error reading km.txt:", err);
        }
      } else {
        kmContent = `
=== SLICE OF HEAVEN PIZZERIA KNOWLEDGE BASE ===
PRICING AND MENU:
- Cheese Pizza (Code: PIZ01): ₹299 (Classic Mozzarella and rich tomato sauce)
- Veggie Delight Pizza (Code: PIZ02): ₹349 (Capsicum, Onion, Tomatoes, Olives)
- Pepperoni Feast Pizza (Code: PIZ03): ₹449 (Double Pepperoni and Extra Mozzarella)
- Thin Crust Base (Code: BAS01): ₹50
- Pan Pizza Base (Code: BAS02): ₹80
- Extra Cheese Topping (Code: TOP01): ₹40
- Jalapenos Topping (Code: TOP02): ₹30

BILLING & POLICIES:
- All prices exclude 5% Goods and Services Tax (GST).
- Cancellations are only allowed for orders in 'confirmed' status. Once 'preparing', we do not accept cancellation since preparation starts immediately.
- Refund processing takes 3-5 business days for Cards/UPI. Cash orders are refunded instantly at the counter.
- Delivery is free for table numbers 1 to 20 inside our dine-in area.
`;
      }

      // Try to load any current orders / menu items from active payload to enrich context
      let contextualData = "";
      if (currentOrders && Array.isArray(currentOrders)) {
        contextualData += `\nACTIVE TODAY'S ORDERS:\n` + JSON.stringify(currentOrders, null, 2);
      }
      if (currentMenuItems && Array.isArray(currentMenuItems)) {
        contextualData += `\nMENU ITEMS:\n` + JSON.stringify(currentMenuItems, null, 2);
      }

      // If specific order context is asked, highlight it
      if (contextOrderId) {
        contextualData += `\nUSER SPECIFIC ORDER CONTEXT ID: ${contextOrderId}\n`;
      }
      if (contextOrderPhone) {
        contextualData += `\nUSER SPECIFIC ORDER PHONE NUMBER: ${contextOrderPhone}\n`;
      }

      // System prompt construction
      const systemContext = `
You are a friendly, concise, and professional Customer Support Chatbot for "Slice of Heaven Pizzeria". 
Your objective is to help clients with inquiries regarding:
1. Pricing & Billing (based on the provided Knowledge Base below).
2. Order Status checks (use the provided ACTIVE TODAY'S ORDERS to answer exactly).
3. Refund and cancellation rules.

=== KNOWLEDGE BASE (km.txt) ===
${kmContent}

=== REAL-TIME DATA CONTEXT ===
${contextualData}

=== INSTRUCTIONS ===
- Be polite, direct, and concise. Do not guess or hallucinate.
- If a customer asks about a specific order status, check if the ID or Phone is present in the "REAL-TIME DATA CONTEXT" above. If found, report the status ('confirmed', 'preparing', 'ready', 'delivered', 'cancelled') and expected time if relevant.
- If the order isn't found, politely ask for their 10-digit phone number or order ID to look it up.
- All monetary quotes must be in Indian Rupees (INR) or ₹.
`;

      // Structure contents for generateContent
      // Mapping previous chat history to parts
      const promptParts = [];
      if (history && Array.isArray(history)) {
        for (const turn of history) {
          promptParts.push({ text: `${turn.role === "user" ? "Customer" : "Assistant"}: ${turn.content}` });
        }
      }
      promptParts.push({ text: `Customer: ${message}` });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: promptParts.map(p => p.text).join("\n"),
        config: {
          systemInstruction: systemContext,
          temperature: 0.3,
        },
      });

      res.json({ text: response.text || "I'm sorry, I couldn't process that response." });
    } catch (e: any) {
      console.error("Gemini API Error:", e);
      res.status(500).json({ error: "Gemini API request failed: " + e.message });
    }
  });

  // 2. Vite / Static Handler setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
