import express from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import {
  validateCustomerName,
  validatePhone,
  validateQuantityInput,
  sanitizeMenuItems,
  validateEmail,
  normalizeCustomerEmail,
} from "./src/lib/inputValidation.ts";
import {
  INPUT_DATA_MENU_FILES,
  readInputDataMenuFileEntry,
  parseMenuFileContent,
  type MenuUpsertPayload,
  checkMenuNameConflict,
  findMenuNameConflicts,
} from "./src/lib/menuImport.ts";
import {
  DEFAULT_APP_SETTINGS,
  normalizeSettingsPatch,
  calcBillTotals,
  currencySymbol,
} from "./src/lib/appSettings.ts";
import type { AppSettings, MenuLoadStatus, OrderWithItems } from "./src/types.ts";
import { formatOrderLogBlock, formatOrdersExportDocument } from "./src/lib/orderFormat.ts";
import { parseAiRecommendations } from "./src/lib/adminRecommendations.ts";
import {
  generateAiText,
  getAiPublicConfig,
  isAiConfigured,
  aiNotConfiguredMessage,
} from "./src/lib/aiProvider.ts";

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = 3000;
const APP_HELP_PATH = path.join(process.cwd(), "docs", "app-help.md");

/** Vercel/serverless: only /tmp is writable; project dir is read-only. */
function isServerlessHost(): boolean {
  return Boolean(process.env.VERCEL);
}

function getWritableBase(): string {
  return isServerlessHost() ? path.join("/tmp", "pizzeria") : process.cwd();
}

function getKmFilePath(): string {
  return path.join(getWritableBase(), "km.txt");
}

function getOutputDir(): string {
  return path.join(getWritableBase(), "output");
}

function getOrdersLogPath(): string {
  return path.join(getOutputDir(), "order_log.txt");
}

function ensureWritableBase() {
  try {
    fs.mkdirSync(getWritableBase(), { recursive: true });
  } catch (err) {
    console.warn("Could not create writable base directory:", err);
  }
}

// In-memory store for fallback data (when Supabase is not connected yet)
// This ensures that even in local-only demo mode, order status and menu items can be resolved by the chatbot!
let mockOrdersStore: any[] = [];
let mockMenuItemsStore: any[] = [];

let appSettingsCache: AppSettings = { ...DEFAULT_APP_SETTINGS };
let menuLoadStatus: MenuLoadStatus = {
  loadedAt: null,
  files: [],
  totalSuccess: 0,
  totalErrors: 0,
  hasErrors: false,
  supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
};

function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.");
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function generateTemporaryPassword() {
  const prefix = Math.random().toString(36).slice(-6).toUpperCase();
  return `${prefix}A1!`;
}

async function sendStaffWelcomeEmail(
  sb: ReturnType<typeof getSupabaseAdminClient>,
  email: string,
  temporaryPassword: string,
  displayName: string | null
): Promise<"credentials" | "recovery"> {
  const appUrl = process.env.APP_URL || process.env.SUPABASE_REDIRECT_URL || "http://localhost:3000";
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.STAFF_EMAIL_FROM;
  const greeting = displayName ? `Hello ${displayName}` : "Hello";

  if (resendKey && from) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Your Slice of Heaven staff account",
          text: [
            `${greeting},`,
            "",
            "An administrator created your Slice of Heaven staff account.",
            "",
            `Sign-in email: ${email}`,
            `Temporary password: ${temporaryPassword}`,
            "",
            `Sign in at: ${appUrl}`,
            "",
            "You must choose a new password on your first login.",
            "",
            "If you did not expect this message, contact your manager.",
          ].join("\n"),
        }),
      });
      if (res.ok) return "credentials";
      console.warn("Resend staff email failed:", await res.text());
    } catch (err) {
      console.warn("Resend staff email error:", err);
    }
  }

  const { error: resetError } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: process.env.SUPABASE_REDIRECT_URL || appUrl,
  });
  if (!resetError) return "recovery";

  throw new Error(
    "Could not email login instructions. Configure Supabase Auth email (SMTP) or set RESEND_API_KEY and STAFF_EMAIL_FROM."
  );
}

/** Walk-in placeholder phone for walk-in orders when DB requires NOT NULL (6 + table id, zero-padded). */
function walkInPhonePlaceholder(tableId: number): string {
  return `6${String(tableId).padStart(9, "0")}`.slice(0, 10);
}

async function updateOrderRow(sb: ReturnType<typeof getSupabaseAdminClient>, orderId: number, updates: Record<string, unknown>) {
  let { data, error } = await sb.from("orders").update(updates).eq("id", orderId).select("*").single();
  if (error && updates.staff_id && (error.code === "23503" || /staff_id|foreign key/i.test(error.message || ""))) {
    const { staff_id: _s, ...rest } = updates;
    ({ data, error } = await sb.from("orders").update(rest).eq("id", orderId).select("*").single());
  }
  if (error) throw error;
  return data;
}

const VALID_PAYMENT_MODES = ["Cash", "Card", "UPI"] as const;

function resolveTableName(row: any, fallbackId?: number | null): string {
  const ti = row?.table_info;
  const name = Array.isArray(ti) ? ti[0]?.table_name : ti?.table_name;
  return name ?? row?.table_name ?? `Table ${fallbackId ?? row?.table_id ?? "?"}`;
}

function ensureOutputDir() {
  ensureWritableBase();
  try {
    fs.mkdirSync(getOutputDir(), { recursive: true });
  } catch (err) {
    console.warn("Could not create output directory:", err);
  }
}

function appendOrderLog(
  order: Record<string, unknown>,
  items: Record<string, unknown>[],
  tableName?: string
) {
  if (isServerlessHost()) {
    // Order log files are ephemeral on Vercel (/tmp); Supabase is the source of truth.
    return;
  }

  try {
    ensureOutputDir();
    const logPath = getOrdersLogPath();

    if (!fs.existsSync(logPath)) {
      const header = [
        "================================================================================",
        " SLICE OF HEAVEN PIZZERIA — COMPLETED ORDERS LOG",
        " Location: output/order_log.txt",
        " Each block = one delivered order (payment collected). Times shown in IST.",
        "================================================================================",
        "",
      ].join("\n");
      fs.writeFileSync(logPath, header, "utf-8");
    }

    const orderForFormat = {
      ...order,
      table_name: tableName || String(order.table_name || ""),
      items,
    } as unknown as OrderWithItems;

    const block = formatOrderLogBlock(orderForFormat, {
      statusLabel: "PAID / DELIVERED",
      timestamp: String(order.delivered_at || new Date().toISOString()),
    });

    fs.appendFileSync(logPath, block, "utf-8");
  } catch (err) {
    console.warn("Could not append order log:", err);
  }
}

function loadKnowledgeBase(): string {
  if (fs.existsSync(APP_HELP_PATH)) {
    try {
      return fs.readFileSync(APP_HELP_PATH, "utf-8");
    } catch (err) {
      console.error("Error reading docs/app-help.md:", err);
    }
  }
  if (fs.existsSync(getKmFilePath())) {
    try {
      return fs.readFileSync(getKmFilePath(), "utf-8");
    } catch (err) {
      console.error("Error reading km.txt:", err);
    }
  }
  return "Slice of Heaven Pizzeria help content is not loaded. See the Help tab in the app.";
}

const VOICE_ORDER_ACTIONS = new Set([
  "show_menu", "verify_customer", "add_combo", "remove_combo",
  "show_cart", "set_table", "place_order", "none",
]);

function buildVoiceOrderSystemPrompt(
  menuJson: string,
  tablesJson: string,
  cartSummary: string,
  customerSummary: string
) {
  return `You are the Slice of Heaven Pizzeria assistant handling VOICE/TYPED ORDERING.
The customer's words come from browser speech-to-text — expect transcription errors. Never guess.

MENU (ONLY these items exist — do not invent items or prices):
${menuJson}

AVAILABLE TABLES: ${tablesJson || "unknown"}

CURRENT CART:
${cartSummary || "empty"}

CUSTOMER:
${customerSummary || "not verified"}

Return ONLY valid JSON (no markdown fences):
{
  "reply": "short friendly message to show/speak (markdown ok)",
  "action": {
    "type": "show_menu" | "verify_customer" | "add_combo" | "remove_combo" | "show_cart" | "set_table" | "place_order" | "none",
    "params": {}
  }
}

Action params:
- show_menu: optional category "base"|"pizza"|"topping"
- verify_customer: name, phone (10 digits), email, address (optional). If incomplete, set unclear:true and ask to TYPE name/phone.
- add_combo: baseName, pizzas [{name, quantity}], toppings [{name, quantity}]. ONLY use exact menu names. If unsure, use type "none" — do NOT add_combo.
- remove_combo: index (1-based) or name. If unclear which item, use "none" and ask to type the item number.
- set_table: tableName e.g. "Table 3"
- show_cart, place_order: empty params
- none: clarification, decline, or general help — always include a helpful reply

ROBUSTNESS RULES (critical):
1. If intent is unclear or speech transcript is garbled → action "none", politely ask customer to TYPE the request in the text box.
2. If multiple menu items could match → action "none", list options, ask to TYPE the exact name.
3. If request is NOT possible here → action "none", politely decline and explain why:
   - No delivery / takeaway through this assistant (dine-in only)
   - No order cancellation or refunds (staff at table)
   - No custom discounts beyond bulk rules
   - No items not on the MENU list
   - No payment method changes during ordering
4. Never use add_combo unless you are confident every item matches the MENU exactly.
5. Ask for name + phone (typed) before place_order if customer is not verified.
6. Use Indian Rupees (₹). Be concise — replies may be spoken aloud.`;
}

function parseVoiceOrderResponse(raw: string) {
  const fallback = {
    text: `I didn't quite catch that. Please type your request below — for example: show menu, add Thin Crust Margherita, or place order.`,
    action: { type: "none" as const, params: {} as Record<string, unknown> },
  };
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return fallback;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      reply?: string;
      action?: { type?: string; params?: Record<string, unknown> };
    };
    const actionType = VOICE_ORDER_ACTIONS.has(String(parsed.action?.type))
      ? parsed.action!.type!
      : "none";
    return {
      text: parsed.reply || fallback.text,
      action: { type: actionType, params: parsed.action?.params || {} },
    };
  } catch {
    return fallback;
  }
}

function syncAppHelpToKnowledgeBase() {
  if (!fs.existsSync(APP_HELP_PATH)) return;
  try {
    ensureWritableBase();
    const content = fs.readFileSync(APP_HELP_PATH, "utf-8");
    fs.writeFileSync(getKmFilePath(), content, "utf-8");
    console.log("Synced docs/app-help.md → km cache for chatbot knowledge base.");
  } catch (err) {
    console.warn("Could not sync app-help.md to km cache:", err);
  }
}

async function verifyCustomerContext(
  sb: ReturnType<typeof getSupabaseAdminClient>,
  ctx: { customerId?: number | null; phone?: string | null; email?: string | null; orderId?: number | null }
) {
  const phoneRegex = /^[6-9]\d{9}$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let customer: Record<string, unknown> | null = null;
  let order: Record<string, unknown> | null = null;

  if (ctx.customerId) {
    const { data } = await sb.from("customers").select("*").eq("id", ctx.customerId).maybeSingle();
    customer = data;
  }
  if (ctx.phone) {
    if (!phoneRegex.test(ctx.phone)) return { ok: false, error: "Phone must be exactly 10 digits starting with 6, 7, 8, or 9." };
    const { data } = await sb.from("customers").select("*").eq("phone", ctx.phone).maybeSingle();
    if (customer && data && customer.id !== data.id) return { ok: false, error: "Customer ID does not match the phone number provided." };
    customer = customer || data;
  }
  if (ctx.email) {
    const normalized = ctx.email.trim().toLowerCase();
    if (!emailRegex.test(normalized)) return { ok: false, error: "Please provide a valid email address." };
    const { data } = await sb.from("customers").select("*").eq("email", normalized).maybeSingle();
    if (customer && data && customer.id !== data.id) return { ok: false, error: "Customer ID does not match the email provided." };
    customer = customer || data;
  }
  if (ctx.orderId) {
    const { data } = await sb.from("orders").select("*").eq("id", ctx.orderId).maybeSingle();
    if (!data) return { ok: false, error: `Order #${ctx.orderId} was not found.` };
    order = data;
    if (customer) {
      if (data.customer_id && data.customer_id !== customer.id) {
        return { ok: false, error: "Order does not belong to the verified customer." };
      }
      if (data.customer_phone && customer.phone && data.customer_phone !== customer.phone) {
        return { ok: false, error: "Order phone does not match the verified customer." };
      }
    }
  }
  if (!customer && !order) return { ok: false, error: "Provide a valid customer ID, phone, email, or order ID to look up account details." };
  return { ok: true, customer, order };
}

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
let serverInitialized = false;

async function initializeServer() {
  if (serverInitialized) return;
  serverInitialized = true;
  // 1. Endpoints
  
  // Endpoint to return keys securely
  app.get("/api/config", (req, res) => {
    res.json({
      supabaseUrl: process.env.SUPABASE_URL || null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
      ...getAiPublicConfig(),
    });
  });

  app.post("/api/staff/invite", async (req, res) => {
    try {
      const { email, displayName, role } = req.body || {};

      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ error: "A valid email address is required." });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const normalizedRole = role === "admin" ? "admin" : "staff";
      const supabaseAdmin = getSupabaseAdminClient();

      const { data: existingProfile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", normalizedEmail)
        .maybeSingle();
      if (existingProfile) {
        return res.status(409).json({ error: `An account with ${normalizedEmail} already exists.` });
      }

      const temporaryPassword = generateTemporaryPassword();
      const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          must_change_password: true,
          invited_by_admin: true,
          display_name: displayName || null,
        },
      });

      if (createError || !createdUser?.user?.id) {
        throw createError || new Error("Unable to create the staff account.");
      }

      const userId = createdUser.user.id;

      try {
        const delivery = await sendStaffWelcomeEmail(
          supabaseAdmin,
          normalizedEmail,
          temporaryPassword,
          displayName || null
        );

        const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
          id: userId,
          email: normalizedEmail,
          display_name: displayName || null,
          role: normalizedRole,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });

        if (profileError) throw profileError;

        const message =
          delivery === "credentials"
            ? `Login credentials were emailed to ${normalizedEmail}. They must change their password on first sign-in.`
            : `A password setup link was emailed to ${normalizedEmail}. They must change their password on first sign-in.`;

        res.json({
          success: true,
          email: normalizedEmail,
          role: normalizedRole,
          emailSent: true,
          message,
        });
      } catch (emailErr) {
        await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
        throw emailErr;
      }
    } catch (err: any) {
      console.error("Staff invite error:", err);
      res.status(500).json({ error: err.message || "Unable to add the staff account right now." });
    }
  });

  app.get("/api/app-help", (_req, res) => {
    try {
      const content = loadKnowledgeBase();
      res.json({ content, source: fs.existsSync(APP_HELP_PATH) ? "docs/app-help.md" : "km.txt" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/favicon.ico", (req, res) => {
    res.type("image/svg+xml");
    res.sendFile(path.join(process.cwd(), "public", "favicon.svg"));
  });

  // KB Status
  app.get("/api/km-status", (req, res) => {
    try {
      if (fs.existsSync(getKmFilePath())) {
        const stats = fs.statSync(getKmFilePath());
        const content = fs.readFileSync(getKmFilePath(), "utf-8");
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
      ensureWritableBase();
      fs.writeFileSync(getKmFilePath(), text, "utf-8");
      res.json({ success: true, message: "km.txt saved successfully!" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Chat session + logging
  app.post("/api/chat/session", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const startedAt = new Date().toISOString();
      const sessionId = crypto.randomUUID();
      const { error } = await sb.from("chat_sessions").insert({
        id: sessionId,
        session_started_at: startedAt,
        user_agent: req.headers["user-agent"] || null,
        message_count: 0,
      });
      if (error) throw error;
      res.json({ sessionId, sessionStartedAt: startedAt });
    } catch (e: any) {
      console.warn("Chat session log skipped (run chat_sessions migration):", e.message);
      res.json({ sessionId: crypto.randomUUID(), sessionStartedAt: new Date().toISOString(), persisted: false });
    }
  });

  app.get("/api/chat/analytics", async (_req, res) => {
    const empty = {
      totalSessions: 0,
      totalMessages: 0,
      verifiedLookups: 0,
      uniqueCustomers: 0,
      recentSessions: [] as unknown[],
      persisted: false,
    };
    try {
      const sb = getSupabaseDataClient();
      const { data: sessions, error: sErr } = await sb
        .from("chat_sessions")
        .select("*")
        .order("session_started_at", { ascending: false })
        .limit(500);
      if (sErr) {
        if (/chat_sessions|relation.*does not exist/i.test(sErr.message || "")) {
          return res.json({ ...empty, message: "Chat sessions table is not available yet." });
        }
        throw sErr;
      }
      const { data: logs, error: lErr } = await sb
        .from("chat_logs")
        .select("*")
        .order("logged_at", { ascending: false })
        .limit(1000);
      if (lErr) {
        if (/chat_logs|relation.*does not exist/i.test(lErr.message || "")) {
          return res.json({
            ...empty,
            totalSessions: sessions?.length || 0,
            recentSessions: (sessions || []).slice(0, 10),
            message: "Chat logs table is not available yet.",
          });
        }
        throw lErr;
      }
      const verifiedChats = (logs || []).filter((l: { verified?: boolean }) => l.verified).length;
      res.json({
        totalSessions: sessions?.length || 0,
        totalMessages: logs?.length || 0,
        verifiedLookups: verifiedChats,
        uniqueCustomers: new Set(
          (logs || []).filter((l: { customer_id?: number | null }) => l.customer_id).map((l: { customer_id: number }) => l.customer_id)
        ).size,
        recentSessions: (sessions || []).slice(0, 10),
        persisted: true,
      });
    } catch (e: any) {
      console.warn("Chat analytics unavailable:", e.message);
      res.json({ ...empty, message: e.message || "Chat analytics unavailable." });
    }
  });

  app.post("/api/chat/verify-customer", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const result = await verifyCustomerContext(sb, {
        customerId: req.body.customerId ? Number(req.body.customerId) : null,
        phone: req.body.phone || null,
        email: req.body.email || null,
        orderId: req.body.orderId ? Number(req.body.orderId) : null,
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ verified: true, customer: result.customer, order: result.order });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Chat API using Gemini (support chat + voice ordering via mode=voice_order)
  app.post("/api/chat", async (req, res) => {
    const {
      message,
      history,
      mode,
      cartSummary,
      customerSummary,
      availableTables,
      contextOrderId,
      contextOrderPhone,
      contextCustomerId,
      contextEmail,
      sessionId,
      currentOrders,
      currentMenuItems,
    } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const isVoiceOrder = mode === "voice_order";

    if (!isAiConfigured()) {
      if (isVoiceOrder) {
        return res.status(200).json({
          text: "Assistant is not configured. Use the suggestion chips or type your order.",
          action: { type: "none", params: {} },
        });
      }
      return res.status(200).json({
        text: `⚠️ ${aiNotConfiguredMessage()}`,
      });
    }

    try {
      const historyText = Array.isArray(history)
        ? history.map((t: { role?: string; content?: string }) =>
            `${t.role === "user" ? "Customer" : "Assistant"}: ${t.content || ""}`
          ).join("\n")
        : "";
      const prompt = [historyText, `Customer: ${message}`, isVoiceOrder ? "JSON:" : ""].filter(Boolean).join("\n");

      if (isVoiceOrder) {
        const menuJson = Array.isArray(currentMenuItems)
          ? JSON.stringify(currentMenuItems.slice(0, 120), null, 0)
          : "[]";
        const tablesJson = Array.isArray(availableTables)
          ? availableTables.map((t: { table_name?: string }) => t.table_name).join(", ")
          : "";

        const raw = await generateAiText({
          systemInstruction: buildVoiceOrderSystemPrompt(
            menuJson,
            tablesJson,
            cartSummary || "",
            customerSummary || ""
          ),
          userContent: prompt,
          temperature: 0.2,
        });

        const { text: replyText, action } = parseVoiceOrderResponse(raw);

        if (sessionId) {
          try {
            const sb = getSupabaseDataClient();
            await sb.from("chat_logs").insert([
              { session_id: sessionId, role: "user", message, logged_at: new Date().toISOString() },
              { session_id: sessionId, role: "assistant", message: replyText, logged_at: new Date().toISOString() },
            ]);
          } catch { /* chat logs optional */ }
        }

        return res.json({ text: replyText, action });
      }

      const sb = getSupabaseDataClient();
      let verifiedContext: { customer?: Record<string, unknown> | null; order?: Record<string, unknown> | null } = {};
      const needsVerification = contextOrderId || contextOrderPhone || contextCustomerId || contextEmail;
      if (needsVerification) {
        const v = await verifyCustomerContext(sb, {
          customerId: contextCustomerId ? Number(contextCustomerId) : null,
          phone: contextOrderPhone || null,
          email: contextEmail || null,
          orderId: contextOrderId ? Number(String(contextOrderId).replace(/^#/, "")) : null,
        });
        if (!v.ok) {
          if (sessionId) {
            try {
              await sb.from("chat_logs").insert({
                session_id: sessionId,
                role: "system",
                message: `Verification failed: ${v.error}`,
                verified: false,
                logged_at: new Date().toISOString(),
              });
            } catch { /* table may not exist yet */ }
          }
          return res.status(400).json({ error: v.error });
        }
        verifiedContext = { customer: v.customer, order: v.order };
      }

      // Load knowledge base (docs/app-help.md synced to km.txt)
      const kmContent = loadKnowledgeBase();

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
      if (verifiedContext.customer) {
        contextualData += `\nVERIFIED CUSTOMER:\n${JSON.stringify(verifiedContext.customer, null, 2)}\n`;
      }
      if (verifiedContext.order) {
        contextualData += `\nVERIFIED ORDER:\n${JSON.stringify(verifiedContext.order, null, 2)}\n`;
      }

      // System prompt construction
      const systemContext = `
You are a friendly, concise, and professional Customer Support Chatbot for "Slice of Heaven Pizzeria". 
Your objective is to help clients with inquiries regarding:
1. Pricing & Billing (based on the provided Knowledge Base below).
2. Order Status checks (use the provided ACTIVE TODAY'S ORDERS to answer exactly).
3. Refund and cancellation rules.

=== KNOWLEDGE BASE (app-help.md) ===
${kmContent}

=== REAL-TIME DATA CONTEXT ===
${contextualData}

=== INSTRUCTIONS ===
- Be polite, direct, and concise. Do not guess or hallucinate.
- If a customer asks about a specific order status, check if the ID or Phone is present in the "REAL-TIME DATA CONTEXT" above. If found, report the status ('confirmed', 'preparing', 'ready', 'delivered', 'cancelled') and expected time if relevant.
- If the order isn't found, politely ask for their 10-digit phone number or order ID to look it up.
- If the request is unclear, ask the customer to type the details (order ID, phone, or item name) rather than guessing.
- If you cannot help (e.g. processing refunds, changing kitchen status, custom discounts), politely decline and direct them to staff at their table.
- All monetary quotes must be in Indian Rupees (INR) or ₹.
`;

      const chatHistory = Array.isArray(history)
        ? history
            .filter((t: { role?: string; content?: string }) => t?.content)
            .map((t: { role?: string; content?: string }) => ({
              role: (t.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
              content: String(t.content || ""),
            }))
        : undefined;

      const replyText = await generateAiText({
        systemInstruction: systemContext,
        userContent: `Customer: ${message}`,
        temperature: 0.3,
        history: chatHistory,
      }) || "I'm sorry, I couldn't process that response.";

      if (sessionId) {
        try {
          await sb.from("chat_logs").insert([
            {
              session_id: sessionId,
              role: "user",
              message,
              customer_id: verifiedContext.customer?.id ?? null,
              customer_phone: verifiedContext.customer?.phone ?? contextOrderPhone ?? null,
              customer_email: verifiedContext.customer?.email ?? contextEmail ?? null,
              order_id: verifiedContext.order?.id ?? (contextOrderId ? Number(String(contextOrderId).replace(/^#/, "")) : null),
              verified: Boolean(needsVerification && verifiedContext.customer || verifiedContext.order),
              logged_at: new Date().toISOString(),
            },
            {
              session_id: sessionId,
              role: "assistant",
              message: replyText,
              verified: Boolean(needsVerification && verifiedContext.customer || verifiedContext.order),
              logged_at: new Date().toISOString(),
            },
          ]);
          await sb.from("chat_sessions").update({
            message_count: (history?.length || 0) + 2,
            updated_at: new Date().toISOString(),
          }).eq("id", sessionId);
        } catch (logErr) {
          console.warn("Chat log insert skipped:", logErr);
        }
      }

      res.json({ text: replyText });
    } catch (e: any) {
      console.error("Gemini API Error:", e);
      res.status(500).json({ error: "Gemini API request failed: " + e.message });
    }
  });

  // ── DATA APIs (service-role, server-side only) ──────────────────────────

  function getSupabaseDataClient() {
    return getSupabaseAdminClient();
  }

  async function assertAdminProfile(staffId: string) {
    if (!staffId) throw new Error("Admin staff id is required.");
    const sb = getSupabaseDataClient();
    const { data, error } = await sb.from("profiles").select("role, is_active").eq("id", staffId).maybeSingle();
    if (error) throw error;
    if (!data || data.role !== "admin") throw new Error("Admin access required.");
    if (data.is_active === false) throw new Error("Admin access required.");
  }

  function bearerToken(req: express.Request): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    return header.slice(7).trim();
  }

  async function getAuthenticatedUser(accessToken: string) {
    const admin = getSupabaseAdminClient();
    const { data: { user }, error } = await admin.auth.getUser(accessToken);
    if (error || !user) throw new Error("Invalid or expired session. Please sign in again.");
    return user;
  }

  async function assertUniqueCustomerPhone(
    sb: ReturnType<typeof getSupabaseDataClient>,
    phone: string,
    excludeId?: number
  ) {
    const trimmed = String(phone).trim();
    const { data, error } = await sb.from("customers").select("id, name").eq("phone", trimmed).maybeSingle();
    if (error) throw error;
    if (data && data.id !== excludeId) {
      throw new Error(`Mobile number ${trimmed} is already registered to ${data.name}.`);
    }
  }

  function mapCustomerDbError(err: any, phone?: string): string {
    if (err?.code === "23505" && /phone/i.test(String(err.message || err.details || ""))) {
      return phone
        ? `Mobile number ${phone} is already registered to another customer.`
        : "This mobile number is already registered to another customer.";
    }
    return err?.message || "Customer save failed.";
  }

  async function loadAppSettingsFromDb(): Promise<AppSettings> {
    try {
      const sb = getSupabaseDataClient();
      const { data, error } = await sb.from("app_settings").select("*").eq("id", 1).maybeSingle();
      if (error) {
        if (/app_settings|relation.*does not exist/i.test(error.message || "")) {
          console.warn("app_settings table missing — using defaults.");
          return { ...DEFAULT_APP_SETTINGS };
        }
        throw error;
      }
      if (!data) return { ...DEFAULT_APP_SETTINGS };
      appSettingsCache = {
        bulk_discount_percent: Number(data.bulk_discount_percent ?? DEFAULT_APP_SETTINGS.bulk_discount_percent),
        bulk_discount_min_qty: Number(data.bulk_discount_min_qty ?? DEFAULT_APP_SETTINGS.bulk_discount_min_qty),
        default_currency: String(data.default_currency ?? DEFAULT_APP_SETTINGS.default_currency),
        gst_percent: Number(data.gst_percent ?? DEFAULT_APP_SETTINGS.gst_percent),
        updated_at: data.updated_at,
      };
      return appSettingsCache;
    } catch (e: any) {
      console.warn("Could not load app_settings:", e.message || e);
      appSettingsCache = { ...DEFAULT_APP_SETTINGS };
      return appSettingsCache;
    }
  }

  async function upsertMenuItemRow(sb: ReturnType<typeof getSupabaseDataClient>, item: MenuUpsertPayload) {
    const code = item.code.trim().toUpperCase();
    const payload = { ...item, code, updated_at: new Date().toISOString() };
    const { data: existing } = await sb.from("menu_items").select("id").eq("code", code).maybeSingle();
    if (existing) {
      const { error } = await sb.from("menu_items").update(payload).eq("id", existing.id);
      if (error) throw error;
      return "replaced" as const;
    }
    const { error } = await sb.from("menu_items").insert(payload);
    if (error) throw error;
    return "created" as const;
  }

  async function importMenuFromInputData(): Promise<MenuLoadStatus> {
    const files: MenuLoadStatus["files"] = [];
    let totalSuccess = 0;
    let totalErrors = 0;

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      menuLoadStatus = {
        loadedAt: new Date().toISOString(),
        files: INPUT_DATA_MENU_FILES.map(({ fileName, category }) => ({
          file: fileName,
          category,
          success: 0,
          created: 0,
          replaced: 0,
          errors: [],
          skipped: true,
          skipReason: "Supabase is not configured — menu import skipped.",
        })),
        totalSuccess: 0,
        totalErrors: 0,
        hasErrors: true,
        supabaseConfigured: false,
        message: "Connect Supabase to load menu files from input_data/.",
      };
      return menuLoadStatus;
    }

    const settings = await loadAppSettingsFromDb();
    let sb: ReturnType<typeof getSupabaseDataClient>;
    try {
      sb = getSupabaseDataClient();
    } catch (e: any) {
      menuLoadStatus = {
        loadedAt: new Date().toISOString(),
        files: [],
        totalSuccess: 0,
        totalErrors: 1,
        hasErrors: true,
        supabaseConfigured: false,
        message: e.message || "Could not connect to Supabase.",
      };
      return menuLoadStatus;
    }

    for (const entry of INPUT_DATA_MENU_FILES) {
      const fileResult: MenuLoadStatus["files"][number] = {
        file: entry.fileName,
        category: entry.category,
        success: 0,
        created: 0,
        replaced: 0,
        errors: [],
        skipped: false,
      };

      const readResult = readInputDataMenuFileEntry(entry);
      if (!readResult.ok) {
        fileResult.skipped = true;
        fileResult.skipReason = readResult.error;
        fileResult.errors.push(
          readResult.error,
          ...(readResult.attempted.length > 1
            ? [`Tried: ${readResult.attempted.join(", ")}`]
            : [])
        );
        totalErrors += 1;
        files.push(fileResult);
        continue;
      }

      if (readResult.resolvedFile !== entry.fileName) {
        fileResult.errors.push(`Loaded fallback file: ${readResult.resolvedFile}`);
      }

      const { items, errors: parseErrors } = parseMenuFileContent(
        readResult.text,
        entry.category,
        settings.default_currency
      );
      fileResult.errors.push(...parseErrors);

      const batchConflicts = findMenuNameConflicts(items);
      if (batchConflicts.length) {
        fileResult.errors.push(...batchConflicts.map((c) => `Duplicate name in file: ${c}`));
      }

      const { data: existingMenu } = await sb.from("menu_items").select("id, name, code, category");

      for (const item of items) {
        const nameConflict = checkMenuNameConflict(existingMenu || [], item);
        if (nameConflict) {
          fileResult.errors.push(`${item.code}: ${nameConflict}`);
          continue;
        }
        if (batchConflicts.some((c) => c.includes(item.name.trim()))) {
          continue;
        }
        try {
          const action = await upsertMenuItemRow(sb, item);
          fileResult.success += 1;
          totalSuccess += 1;
          if (action === "created") fileResult.created += 1;
          else fileResult.replaced += 1;
        } catch (e: any) {
          fileResult.errors.push(`${item.code}: ${e.message || "Import failed"}`);
        }
      }

      totalErrors += fileResult.errors.length;
      files.push(fileResult);
    }

    menuLoadStatus = {
      loadedAt: new Date().toISOString(),
      files,
      totalSuccess,
      totalErrors,
      hasErrors: totalErrors > 0 || files.some(f => f.skipped),
      supabaseConfigured: true,
      message: totalErrors > 0 || files.some(f => f.skipped)
        ? "Some menu files had issues. Fix input_data/ files and re-upload via Admin → Menu after startup."
        : undefined,
    };

    if (menuLoadStatus.hasErrors) {
      console.warn("input_data menu import completed with issues:", JSON.stringify(menuLoadStatus, null, 2));
    } else {
      console.log(`input_data menu import: ${totalSuccess} items loaded.`);
    }

    return menuLoadStatus;
  }

  // Tables
  app.get("/api/tables", async (_req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const { data, error } = await sb.from("table_info").select("*").order("table_name", { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/tables/:tableName/usage", async (req, res) => {
    try {
      const { is_in_use } = req.body;
      const sb = getSupabaseDataClient();
      const { data, error } = await sb
        .from("table_info")
        .update({ is_in_use, updated_at: new Date().toISOString() })
        .eq("table_name", req.params.tableName)
        .select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Menu items
  app.get("/api/menu", async (_req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const { data, error } = await sb.from("menu_items").select("*")
        .order("category", { ascending: true }).order("name", { ascending: true });
      if (error) throw error;
      const { valid, skipped } = sanitizeMenuItems(data || []);
      if (skipped.length) console.warn("Menu items skipped:", skipped.join("; "));
      res.json(valid);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/menu", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const code = (req.body.code || "").trim().toUpperCase();
      if (!code || code.length < 2 || code.length > 10) return res.status(400).json({ error: "Item Code must be 2–10 characters." });
      if (!/^[A-Z0-9_-]+$/.test(code)) return res.status(400).json({ error: "Item Code must be alphanumeric, dashes or underscores only." });
      if (req.body.price_inr == null || req.body.price_inr === '') {
        return res.status(400).json({ error: "Price field is required for every menu item." });
      }
      if (req.body.price_inr <= 0 || req.body.price_inr > 10000) return res.status(400).json({ error: "Price must be between 1 and 10,000 INR." });
      const category = req.body.category;
      if (!['base', 'pizza', 'topping'].includes(category)) {
        return res.status(400).json({ error: "Category must be base, pizza, or topping." });
      }
      const name = String(req.body.name || "").trim();
      if (!name) return res.status(400).json({ error: "Item name is required." });

      const { data: existing } = await sb.from("menu_items").select("id").eq("code", code).maybeSingle();
      if (existing) return res.status(409).json({ error: `Menu item with code ${code} already exists.` });

      const { data: allMenu } = await sb.from("menu_items").select("id, name, code, category");
      const nameConflict = checkMenuNameConflict(allMenu || [], { name, code, category });
      if (nameConflict) return res.status(409).json({ error: nameConflict });

      const payload = {
        code,
        category,
        name,
        price_inr: Number(req.body.price_inr),
        currency: req.body.currency || "INR",
        description: req.body.description?.trim() || null,
        is_active: req.body.is_active !== false,
      };
      const { data, error } = await sb.from("menu_items").insert(payload).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/menu/:id", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const itemId = parseInt(req.params.id);
      if (Number.isNaN(itemId)) return res.status(400).json({ error: "Invalid menu item ID." });

      const { data: current, error: currentErr } = await sb
        .from("menu_items").select("*").eq("id", itemId).maybeSingle();
      if (currentErr) throw currentErr;
      if (!current) return res.status(404).json({ error: "Menu item not found." });

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (req.body.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name) return res.status(400).json({ error: "Item name cannot be empty." });
        updates.name = name;
      }
      if (req.body.category !== undefined) {
        if (!['base', 'pizza', 'topping'].includes(req.body.category)) {
          return res.status(400).json({ error: "Category must be base, pizza, or topping." });
        }
        updates.category = req.body.category;
      }
      if (req.body.price_inr !== undefined) {
        const price = Number(req.body.price_inr);
        if (!Number.isFinite(price) || price <= 0 || price > 10000) {
          return res.status(400).json({ error: "Price must be between 1 and 10,000 INR." });
        }
        updates.price_inr = price;
      }
      if (req.body.description !== undefined) {
        updates.description = req.body.description?.trim() || null;
      }
      if (req.body.is_active !== undefined) {
        updates.is_active = Boolean(req.body.is_active);
      }
      if (req.body.currency !== undefined) {
        updates.currency = String(req.body.currency).trim().toUpperCase();
      }

      const nextName = String(updates.name ?? current.name);
      const nextCategory = String(updates.category ?? current.category);
      const { data: allMenu } = await sb.from("menu_items").select("id, name, code, category");
      const nameConflict = checkMenuNameConflict(allMenu || [], {
        id: itemId,
        name: nextName,
        code: current.code,
        category: nextCategory,
      });
      if (nameConflict) return res.status(409).json({ error: nameConflict });

      const { data, error } = await sb.from("menu_items")
        .update(updates)
        .eq("id", itemId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/startup/menu-load", (_req, res) => {
    res.json(menuLoadStatus);
  });

  app.post("/api/menu/reload-input-data", async (_req, res) => {
    try {
      const status = await importMenuFromInputData();
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await loadAppSettingsFromDb();
      res.json(settings);
    } catch (e: any) {
      res.json({ ...DEFAULT_APP_SETTINGS });
    }
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const { staffId, ...rawPatch } = req.body || {};
      await assertAdminProfile(String(staffId || ""));
      const patch = normalizeSettingsPatch(rawPatch);
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No valid settings fields provided." });
      }

      const sb = getSupabaseDataClient();
      const payload = {
        id: 1,
        ...patch,
        updated_at: new Date().toISOString(),
        updated_by: staffId,
      };

      const { data: existing } = await sb.from("app_settings").select("id").eq("id", 1).maybeSingle();
      let data;
      if (existing) {
        const result = await sb.from("app_settings").update(payload).eq("id", 1).select().single();
        if (result.error) throw result.error;
        data = result.data;
      } else {
        const result = await sb.from("app_settings").insert(payload).select().single();
        if (result.error) throw result.error;
        data = result.data;
      }

      appSettingsCache = {
        bulk_discount_percent: Number(data.bulk_discount_percent),
        bulk_discount_min_qty: Number(data.bulk_discount_min_qty),
        default_currency: String(data.default_currency),
        gst_percent: Number(data.gst_percent),
        updated_at: data.updated_at,
      };
      res.json(appSettingsCache);
    } catch (e: any) {
      res.status(e.message === "Admin access required." ? 403 : 400).json({ error: e.message });
    }
  });

  // Customers
  app.get("/api/customers", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const page = parseInt(String(req.query.page || "1"));
      const pageSize = parseInt(String(req.query.pageSize || "10"));
      const search = String(req.query.search || "");
      let query = sb.from("customers").select("*", { count: "exact" });
      if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      const { data, count, error } = await query.order("id", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);
      if (error) throw error;
      res.json({ data: data || [], totalCount: count || 0 });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/customers/lookup", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const { phone, email } = req.query;
      let query = sb.from("customers").select("*");
      if (phone) query = query.eq("phone", String(phone));
      else if (email) query = query.eq("email", String(email).toLowerCase());
      else return res.status(400).json({ error: "Provide phone or email." });
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      res.json(data || null);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const nameCheck = validateCustomerName(req.body.name);
      if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });
      const phoneCheck = validatePhone(req.body.phone);
      if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.error });

      const emailNorm = normalizeCustomerEmail(req.body.email);
      if (emailNorm) {
        const emailCheck = validateEmail(emailNorm);
        if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });
      }

      const payload = {
        name: String(req.body.name).trim(),
        phone: String(req.body.phone).trim(),
        email: emailNorm,
        delivery_address: req.body.delivery_address?.trim() || null,
      };

      await assertUniqueCustomerPhone(sb, payload.phone);

      const { data, error } = await sb.from("customers").insert(payload).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      const phone = String(req.body?.phone || "").trim();
      const msg = mapCustomerDbError(e, phone);
      const status = /already registered/i.test(msg) ? 409 : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.patch("/api/customers/:id", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (req.body.name !== undefined) {
        const nameCheck = validateCustomerName(req.body.name);
        if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });
        updates.name = String(req.body.name).trim();
      }
      if (req.body.phone !== undefined) {
        const phoneCheck = validatePhone(req.body.phone);
        if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.error });
        updates.phone = String(req.body.phone).trim();
      }
      if (req.body.email !== undefined) {
        const emailNorm = normalizeCustomerEmail(req.body.email);
        if (emailNorm) {
          const emailCheck = validateEmail(emailNorm);
          if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });
        }
        updates.email = emailNorm;
      }
      if (req.body.delivery_address !== undefined) {
        updates.delivery_address = req.body.delivery_address?.trim() || null;
      }

      const customerId = Number(req.params.id);
      if (updates.phone !== undefined) {
        await assertUniqueCustomerPhone(sb, String(updates.phone), customerId);
      }

      const { data, error } = await sb.from("customers")
        .update(updates)
        .eq("id", req.params.id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      const phone = req.body?.phone != null ? String(req.body.phone).trim() : undefined;
      const msg = mapCustomerDbError(e, phone);
      const status = /already registered/i.test(msg) ? 409 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // Orders
  async function loadStaffNameMap(staffIds: string[]) {
    const map = new Map<string, string>();
    if (!staffIds.length) return map;
    const sb = getSupabaseDataClient();
    const { data, error } = await sb.from("profiles").select("id, display_name, email").in("id", staffIds);
    if (error) throw error;
    for (const profile of data || []) {
      map.set(profile.id, profile.display_name?.trim() || profile.email || "Unknown staff");
    }
    return map;
  }

  async function attachStaffLabels<T extends { staff_id?: string | null }>(orders: T[]) {
    const staffIds = [...new Set(orders.map((o) => o.staff_id).filter((id): id is string => Boolean(id)))];
    const staffMap = await loadStaffNameMap(staffIds);
    return orders.map((o) => ({
      ...o,
      staff_name: o.staff_id ? (staffMap.get(o.staff_id) ?? null) : null,
    }));
  }

  async function attachStaffLabel<T extends { staff_id?: string | null }>(order: T) {
    const [withStaff] = await attachStaffLabels([order]);
    return withStaff;
  }

  async function fetchAllOrdersWithItems(): Promise<OrderWithItems[]> {
    const sb = getSupabaseDataClient();
    const { data: orders, error: ordersErr } = await sb
      .from("orders").select("*, table_info(table_name)").order("id", { ascending: false });
    if (ordersErr) throw ordersErr;
    const { data: items, error: itemsErr } = await sb.from("order_items").select("*");
    if (itemsErr) throw itemsErr;
    const mapped = (orders || []).map((o: any) => {
      const table_name = resolveTableName(o);
      const { table_info: _ti, ...fields } = o;
      return { ...fields, table_name, items: (items || []).filter((i: any) => i.order_id === o.id) };
    });
    return attachStaffLabels(mapped) as Promise<OrderWithItems[]>;
  }

  app.get("/api/orders", async (_req, res) => {
    try {
      res.json(await fetchAllOrdersWithItems());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/orders/export", async (req, res) => {
    try {
      const staffId = String(req.query.staffId || "");
      await assertAdminProfile(staffId);
      const statusFilter = String(req.query.status || "").trim().toLowerCase();
      let orders = await fetchAllOrdersWithItems();
      if (statusFilter && statusFilter !== "all") {
        orders = orders.filter((o) => o.status === statusFilter);
      }
      const text = formatOrdersExportDocument(
        orders,
        statusFilter && statusFilter !== "all" ? `ORDERS EXPORT (${statusFilter.toUpperCase()})` : "ALL ORDERS EXPORT"
      );
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="orders_export_${Date.now()}.txt"`);
      res.send(text);
    } catch (e: any) {
      res.status(e.message === "Admin access required." ? 403 : 500).json({ error: e.message });
    }
  });

  app.post("/api/admin/recommendations/ai", async (req, res) => {
    try {
      const { staffId, analyticsSnapshot } = req.body || {};
      await assertAdminProfile(String(staffId || ""));

      if (!isAiConfigured()) {
        return res.json({ recommendations: [], aiAvailable: false, message: aiNotConfiguredMessage() });
      }

      if (!analyticsSnapshot || typeof analyticsSnapshot !== "object") {
        return res.status(400).json({ error: "analyticsSnapshot is required." });
      }

      const snapshotJson = JSON.stringify(analyticsSnapshot, null, 0);

      const systemInstruction = `You are a restaurant operations analyst for Slice of Heaven Pizzeria (India, INR, dine-in pizza).
Given structured analytics JSON (historic + current orders, tables, staff, cancellations, sales trends), produce 4–8 ADDITIONAL actionable recommendations not obvious from raw numbers alone.

Consider: day-of-week patterns, hour-of-day rushes, table-specific preferences, seasonal context (month/season in snapshot), pizza & topping trends, staff performance gaps, cancellation root causes.

Return ONLY valid JSON (no markdown):
{
  "recommendations": [
    {
      "id": "ai-unique-id",
      "category": "temporal"|"table"|"sales"|"staff"|"cancellation"|"operations"|"customer",
      "priority": "high"|"medium"|"low",
      "title": "short headline",
      "detail": "2-3 sentences with specific numbers from the snapshot",
      "action": "concrete admin action",
      "rationale": "why this matters — season, behavior, ops theory",
      "evidence": "data point cited",
      "impacts": [
        {
          "area": "delivery_time"|"satisfaction"|"revenue"|"efficiency",
          "direction": "improve"|"risk"|"neutral",
          "magnitude": "high"|"medium"|"low",
          "summary": "estimated outcome e.g. 10-15% faster delivery or ₹X revenue uplift"
        }
      ]
    }
  ]
}

Rules:
- Every recommendation MUST have 2-3 impacts with quantified estimates where possible.
- Do NOT repeat generic advice already implied by single metrics; synthesize cross-signals.
- Use Indian context (IST, ₹, local dining habits).
- If data is sparse, say so in detail and lower priority.`;

      const raw = await generateAiText({
        systemInstruction,
        userContent: `Analytics snapshot:\n${snapshotJson}\n\nGenerate recommendations JSON:`,
        temperature: 0.35,
      });

      let parsed: unknown = null;
      try {
        const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch {
            parsed = null;
          }
        }
      }

      const recommendations = parseAiRecommendations(parsed);
      res.json({ recommendations, aiAvailable: true });
    } catch (e: any) {
      res.status(e.message === "Admin access required." ? 403 : 500).json({ error: e.message });
    }
  });

  app.get("/api/orders/:id", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const orderId = parseInt(req.params.id);
      if (Number.isNaN(orderId)) return res.status(400).json({ error: "Invalid order ID." });
      const { data: order, error: orderErr } = await sb
        .from("orders").select("*, table_info(table_name)").eq("id", orderId).maybeSingle();
      if (orderErr) throw orderErr;
      if (!order) return res.status(404).json({ error: "Order not found." });
      const { data: items } = await sb.from("order_items").select("*").eq("order_id", orderId);
      const table_name = resolveTableName(order);
      const { table_info: _ti, ...fields } = order;
      res.json(await attachStaffLabel({ ...fields, table_name, items: items || [] }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/orders/:id/status", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const orderId = parseInt(req.params.id);
      if (Number.isNaN(orderId)) return res.status(400).json({ error: "Invalid order ID." });
      const { data: order, error } = await sb
        .from("orders").select("id, status, table_id, customer_name, customer_phone, total_payable, payment_mode, created_at, ready_at, delivered_at, table_info(table_name)")
        .eq("id", orderId).maybeSingle();
      if (error) throw error;
      if (!order) return res.status(404).json({ error: "Order not found." });
      const table_name = resolveTableName(order);
      const { table_info: _ti, ...fields } = order;
      res.json({ ...fields, table_name });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/orders", async (req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const { orderData, items } = req.body;

      // Validate customer intake (required)
      const trimmedName = (orderData.customer_name || "").trim();
      const trimmedPhone = (orderData.customer_phone || "").trim();
      const nameCheck = validateCustomerName(trimmedName);
      if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });
      const phoneCheck = validatePhone(trimmedPhone);
      if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.error });
      const qtyCheck = validateQuantityInput(orderData.total_quantity, { min: 1, max: 10, label: "Total pizza quantity" });
      if (!qtyCheck.ok) return res.status(400).json({ error: qtyCheck.error });

      const settings = appSettingsCache;
      const { discount: expectedDiscount, gst: expectedGst, total_payable: expectedTotal } = calcBillTotals(
        Number(orderData.subtotal),
        Number(orderData.total_quantity),
        settings
      );
      if (orderData.currency && String(orderData.currency).toUpperCase() !== settings.default_currency) {
        return res.status(400).json({ error: `Orders must use ${settings.default_currency} as configured in admin settings.` });
      }
      if (Number(orderData.discount) !== expectedDiscount) {
        const sym = currencySymbol(settings.default_currency);
        return res.status(400).json({
          error: `Bulk discount should be ${sym}${expectedDiscount} for ${orderData.total_quantity} pizzas (${settings.bulk_discount_percent}% at ${settings.bulk_discount_min_qty}+).`,
        });
      }
      if (Number(orderData.gst) !== expectedGst || Number(orderData.total_payable) !== expectedTotal)
        return res.status(400).json({ error: "Bill totals do not match subtotal, discount, and GST rules." });

      // Resolve table
      const { data: tableRow, error: tableErr } = await sb.from("table_info")
        .select("*").eq("table_name", orderData.table_name).maybeSingle();
      if (tableErr) throw tableErr;
      if (!tableRow) return res.status(400).json({ error: `Table "${orderData.table_name}" not found.` });
      if (tableRow.is_in_use) return res.status(409).json({ error: `Table ${orderData.table_name} is currently occupied.` });

      // Insert order
      const { table_name, status: _s, ...orderFields } = orderData;
      const insertPayload = {
        ...orderFields,
        customer_name: trimmedName,
        customer_phone: trimmedPhone,
        table_id: tableRow.id,
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        cooking_started_at: null, ready_at: null, served_at: null,
        delivered_at: null, cancelled_at: null, cancellation_reason: null,
      };

      const { data: newOrder, error: orderErr } = await sb.from("orders").insert(insertPayload).select().single();
      if (orderErr) throw orderErr;

      // Insert line items
      const lineItems = (items || []).map((item: any) => ({
        order_id: newOrder.id,
        menu_item_id: item.menu_item_id,
        category: item.category,
        name: item.name,
        unit_price_snapshot: item.unit_price_snapshot,
        currency: item.currency || "INR",
        quantity: item.quantity,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { data: newItems, error: itemsErr } = await sb.from("order_items").insert(lineItems).select();
      if (itemsErr) {
        await sb.from("orders").delete().eq("id", newOrder.id);
        throw itemsErr;
      }

      // Mark table in use
      await sb.from("table_info")
        .update({ is_in_use: true, updated_at: new Date().toISOString() })
        .eq("table_name", orderData.table_name);

      res.json(await attachStaffLabel({ ...newOrder, table_name: orderData.table_name, items: newItems }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/orders/:id/status", async (req, res) => {
    if (req.method !== "PATCH") {
      return res.status(405).json({ error: "Use PATCH with JSON body: { newStatus, paymentMode?, staffId?, cancellationReason? }" });
    }
    try {
      const sb = getSupabaseDataClient();
      const orderId = parseInt(req.params.id);
      const { newStatus, cancellationReason, staffId, paymentMode } = req.body;

      // Fetch current order
      const { data: current, error: fetchErr } = await sb.from("orders")
        .select("*, table_info(table_name)").eq("id", orderId).single();
      if (fetchErr || !current) return res.status(404).json({ error: "Order not found." });

      // Transition guards
      const s = current.status;
      if (s === "cancelled") return res.status(400).json({ error: "Order is already cancelled." });
      if (s === "delivered") return res.status(400).json({ error: "Order has already been delivered." });
      if (newStatus === "cancelled" && s !== "confirmed") return res.status(400).json({ error: `Cannot cancel an order in '${s}' state.` });
      if (newStatus === "preparing" && s !== "confirmed") return res.status(400).json({ error: `Order must be confirmed to start preparing.` });
      if (newStatus === "ready" && s !== "preparing") return res.status(400).json({ error: `Order must be preparing to mark ready.` });
      if (newStatus === "ready_to_bill" && s !== "ready" && s !== "ready_to_bill") {
        return res.status(400).json({ error: `Order must be ready before marking served. Current status: '${s}'.` });
      }
      if (newStatus === "delivered" && s !== "ready" && s !== "ready_to_bill") {
        return res.status(400).json({ error: `Order must be ready before collecting payment. Current status: '${s}'.` });
      }
      if (newStatus === "delivered" && !current.served_at) {
        return res.status(400).json({ error: "Mark the order as served before collecting payment." });
      }
      if (newStatus === "delivered") {
        if (!paymentMode || !VALID_PAYMENT_MODES.includes(paymentMode)) {
          return res.status(400).json({ error: "Payment mode must be exactly one of: Cash, Card, or UPI." });
        }
      }

      const now = new Date().toISOString();
      const updates: any = { updated_at: now };

      // ready_to_bill is a UI-only step — DB stays 'ready' until payment (avoids CHECK constraint issues)
      if (newStatus === "ready_to_bill") {
        if (staffId) updates.staff_id = staffId;
        updates.served_at = now;
        const kept = await updateOrderRow(sb, orderId, updates);
        const { data: items } = await sb.from("order_items").select("*").eq("order_id", orderId);
        const table_name = resolveTableName(current, kept.table_id);
        return res.json(await attachStaffLabel({ ...kept, status: "ready_to_bill", table_name, items: items || [] }));
      }

      updates.status = newStatus;
      if (staffId) updates.staff_id = staffId;
      if (newStatus === "preparing") updates.cooking_started_at = now;
      if (newStatus === "ready") updates.ready_at = now;
      if (newStatus === "delivered") {
        updates.delivered_at = now;
        if (paymentMode) updates.payment_mode = paymentMode;
      }
      if (newStatus === "cancelled") {
        updates.cancelled_at = now;
        updates.cancellation_reason = cancellationReason || "Not specified";
      }

      const updated = await updateOrderRow(sb, orderId, updates);

      const { data: items } = await sb.from("order_items").select("*").eq("order_id", orderId);
      const table_name = resolveTableName(updated, current.table_id ?? updated?.table_id);

      // Free table on delivered/cancelled
      if (newStatus === "delivered" || newStatus === "cancelled") {
        const tableId = current.table_id ?? updated?.table_id;
        if (tableId) {
          await sb.from("table_info")
            .update({ is_in_use: false, updated_at: now })
            .eq("id", tableId);
        } else if (table_name && table_name !== `Table ${tableId ?? "?"}`) {
          await sb.from("table_info")
            .update({ is_in_use: false, updated_at: now })
            .eq("table_name", table_name);
        }
      }

      if (newStatus === "delivered") {
        appendOrderLog(updated, items || [], table_name);
        const payload = await attachStaffLabel({ ...updated, table_name, items: items || [] });
        return res.json({
          ...payload,
          confirmationMessage: `Payment confirmed via ${paymentMode}. Order #${orderId} is complete. Thank you!`,
        });
      }

      res.json(await attachStaffLabel({ ...updated, table_name, items: items || [] }));
    } catch (e: any) {
      console.error("Order status PATCH error:", e);
      const msg = e.message || e.details || "Status update failed.";
      res.status(500).json({ error: msg });
    }
  });

  // Profiles
  app.get("/api/profiles/me", async (req, res) => {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ error: "Authorization Bearer token required." });

      const user = await getAuthenticatedUser(token);
      const sb = getSupabaseDataClient();
      const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(404).json({
          error: "No staff profile exists for this account. Ask an admin to invite you or link your auth user in profiles.",
        });
      }
      res.json(data);
    } catch (e: any) {
      const msg = e.message || "Unable to load profile.";
      res.status(/invalid|expired|authorization/i.test(msg) ? 401 : 500).json({ error: msg });
    }
  });

  app.get("/api/profiles", async (_req, res) => {
    try {
      const sb = getSupabaseDataClient();
      const { data, error } = await sb.from("profiles").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/profiles/:id", async (req, res) => {
    try {
      const { staffId, is_active, display_name, role } = req.body || {};
      await assertAdminProfile(String(staffId || ""));

      const targetId = String(req.params.id);
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (is_active !== undefined) updates.is_active = Boolean(is_active);
      if (display_name !== undefined) updates.display_name = display_name?.trim() || null;
      if (role !== undefined) updates.role = role === "admin" ? "admin" : "staff";

      if (Object.keys(updates).length === 1) {
        return res.status(400).json({ error: "No valid fields to update." });
      }

      const sb = getSupabaseDataClient();

      if (is_active === false) {
        const { data: target, error: targetErr } = await sb
          .from("profiles")
          .select("role, is_active")
          .eq("id", targetId)
          .maybeSingle();
        if (targetErr) throw targetErr;
        if (target?.role === "admin") {
          const { data: activeAdmins, error: adminErr } = await sb
            .from("profiles")
            .select("id")
            .eq("role", "admin")
            .eq("is_active", true);
          if (adminErr) throw adminErr;
          const others = (activeAdmins || []).filter((a: { id: string }) => a.id !== targetId);
          if (others.length === 0) {
            return res.status(400).json({ error: "Cannot deactivate the last active admin account." });
          }
        }
      }

      const { data, error } = await sb.from("profiles")
        .update(updates)
        .eq("id", targetId)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      res.status(e.message === "Admin access required." ? 403 : 500).json({ error: e.message });
    }
  });

  app.delete("/api/profiles/:id", async (req, res) => {
    try {
      const staffId = String(req.body?.staffId || req.query.staffId || "");
      await assertAdminProfile(staffId);

      const targetId = String(req.params.id);
      if (targetId === staffId) {
        return res.status(400).json({ error: "You cannot delete your own account while signed in." });
      }

      const sb = getSupabaseDataClient();
      const { count, error: countErr } = await sb
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("staff_id", targetId);
      if (countErr) throw countErr;
      if ((count || 0) > 0) {
        return res.status(409).json({
          error: `This user is linked to ${count} order(s) and cannot be deleted. Deactivate the account instead.`,
        });
      }

      const supabaseAdmin = getSupabaseAdminClient();
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(targetId);
      if (authErr) throw authErr;

      const { error: profileErr } = await sb.from("profiles").delete().eq("id", targetId);
      if (profileErr) throw profileErr;

      res.json({ success: true });
    } catch (e: any) {
      res.status(e.message === "Admin access required." ? 403 : 500).json({ error: e.message });
    }
  });

  // ── END DATA APIs ────────────────────────────────────────────────────────

  // Unmatched /api/* must return JSON — never fall through to Vite/SPA HTML
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found. Restart the dev server (npm run dev) if you recently added routes." });
  });

  syncAppHelpToKnowledgeBase();
  if (!isServerlessHost()) {
    ensureOutputDir();
  }

  await loadAppSettingsFromDb().catch(() => {});
  await importMenuFromInputData().catch((err) => {
    console.error("Startup menu import failed:", err);
    menuLoadStatus = {
      ...menuLoadStatus,
      loadedAt: new Date().toISOString(),
      hasErrors: true,
      totalErrors: menuLoadStatus.totalErrors + 1,
      message: "Menu import failed at startup. Fix input_data/ files and re-upload via Admin → Menu.",
      files: menuLoadStatus.files.length
        ? menuLoadStatus.files
        : [{
            file: "input_data",
            category: "pizza",
            success: 0,
            created: 0,
            replaced: 0,
            errors: [String(err?.message || err)],
            skipped: true,
            skipReason: "Import failed",
          }],
    };
  });
}

async function startServer() {
  await initializeServer();

  const distPath = path.join(process.cwd(), "dist");
  const distIndex = path.join(distPath, "index.html");
  // npm run dev must always use Vite — .env may set NODE_ENV=production incorrectly
  const useVite =
    process.env.npm_lifecycle_event === "dev" ||
    (process.env.NODE_ENV !== "production" && !fs.existsSync(distIndex));

  const httpServer = createHttpServer(app);

  if (useVite) {
    const vite = await createViteServer({
      configFile: path.join(process.cwd(), "vite.config.ts"),
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : { server: httpServer },
        watch: process.env.DISABLE_HMR === "true" ? null : undefined,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(distIndex);
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

/** Vercel serverless handler — serves /api/* only (static UI comes from dist/). */
export async function handler(req: any, res: any) {
  await initializeServer();
  return new Promise<void>((resolve, reject) => {
    app(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
  });
}
