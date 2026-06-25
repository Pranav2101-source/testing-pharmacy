import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lightbulb, X, Search, ChevronDown, ArrowRight,
  Receipt, Package2, ShoppingCart, BarChart3, TicketCheck,
  BookOpen, Zap, Users, RotateCcw, AlertTriangle,
  Calendar, TrendingUp, Tag, Truck, CreditCard,
  Settings, FlaskConical, Bell, FileText,
  Phone, CheckCircle2, DollarSign, Hash, Keyboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isSupportStaff } from "@/lib/auth";
import { NewTicketModal } from "@/components/support/NewTicketModal";
import { useToast } from "@/hooks/useToast";

// ── Types ─────────────────────────────────────────────────────────────────────

type RichBlock =
  | { type: "text";     content: string }
  | { type: "tip";      content: string }
  | { type: "warning";  content: string }
  | { type: "steps";    steps: string[] }
  | { type: "badges";   items: { label: string; color: string; desc: string }[] }
  | { type: "shortcut"; keys: string[]; desc: string }
  | { type: "grid";     items: { icon: React.ElementType; label: string; desc: string; color: string }[] };

type HelpItem = {
  id:       string;
  question: string;
  tags:     string[];
  blocks:   RichBlock[];
};

type HelpCategory = {
  id:        string;
  label:     string;
  icon:      React.ElementType;
  color:     string;
  bg:        string;
  activeBg:  string;
  items:     HelpItem[];
};

// ── All content ───────────────────────────────────────────────────────────────

const CATEGORIES: HelpCategory[] = [

  // ── Keyboard Shortcuts ────────────────────────────────────────────────────
  {
    id: "shortcuts", label: "Shortcuts", icon: Keyboard,
    color: "text-blue-600", bg: "bg-blue-50", activeBg: "bg-blue-600",
    items: [
      {
        id: "global-shortcuts", question: "Global shortcuts — work everywhere",
        tags: ["shortcut", "keyboard", "global", "f2", "ctrl k", "hotkey"],
        blocks: [
          { type: "text", content: "These shortcuts work on any page in the app — no matter where you are." },
          { type: "shortcut", keys: ["F2"],           desc: "Open New Bill from anywhere in the app" },
          { type: "shortcut", keys: ["Ctrl", "K"],    desc: "Focus the global search bar in the top nav" },
          { type: "shortcut", keys: ["Escape"],        desc: "Close any open dropdown, modal, or panel" },
          { type: "tip", content: "F2 is the fastest way to start billing. It works from any page as long as your cursor is not inside an input box." },
        ],
      },
      {
        id: "billing-shortcuts", question: "Billing page shortcuts",
        tags: ["billing", "shortcut", "f9", "f8", "ctrl s", "alt", "save", "print", "draft"],
        blocks: [
          { type: "text", content: "These shortcuts are active only when you are on the New Bill page (/billing/new)." },
          { type: "shortcut", keys: ["F9"],           desc: "Save & Print — finalise bill and open print dialog" },
          { type: "shortcut", keys: ["F8"],           desc: "Save & New — save bill and immediately open a fresh one" },
          { type: "shortcut", keys: ["Ctrl", "S"],    desc: "Save as Draft — park the bill without finalising" },
          { type: "shortcut", keys: ["Alt", "1"],     desc: "Switch payment mode to Cash" },
          { type: "shortcut", keys: ["Alt", "2"],     desc: "Switch payment mode to UPI" },
          { type: "shortcut", keys: ["Alt", "3"],     desc: "Switch payment mode to Card" },
          { type: "shortcut", keys: ["Alt", "4"],     desc: "Switch payment mode to Credit" },
          { type: "tip", content: "Alt+1–4 change the payment mode instantly without touching the mouse. Very useful at a busy counter." },
        ],
      },
      {
        id: "medicine-search-shortcuts", question: "Medicine search shortcuts",
        tags: ["medicine", "search", "shortcut", "arrow", "enter", "escape", "barcode", "alternatives"],
        blocks: [
          { type: "text", content: "When the medicine search dropdown is open on the billing screen:" },
          { type: "shortcut", keys: ["↓ / ↑"],       desc: "Move highlight up or down through search results" },
          { type: "shortcut", keys: ["Enter"],        desc: "Add highlighted medicine to the bill" },
          { type: "shortcut", keys: ["→"],            desc: "Open generic alternatives / substitutes for highlighted medicine" },
          { type: "shortcut", keys: ["Escape"],       desc: "Close search results and clear the query" },
          { type: "tip", content: "Barcode scanners (USB wedge) are auto-detected. Scan any barcode and the medicine is found and added instantly — no need to type." },
        ],
      },
      {
        id: "customer-search-shortcuts", question: "Customer search shortcuts",
        tags: ["customer", "search", "shortcut", "arrow", "enter", "escape"],
        blocks: [
          { type: "text", content: "When searching for a customer/patient in the billing header:" },
          { type: "shortcut", keys: ["↓ / ↑"],       desc: "Navigate through matching customers" },
          { type: "shortcut", keys: ["Enter"],        desc: "Select the highlighted customer, or open 'Add New Customer' if at the last row" },
          { type: "shortcut", keys: ["Escape"],       desc: "Close the customer dropdown" },
        ],
      },
      {
        id: "stock-audit-shortcuts", question: "Stock Audit shortcuts",
        tags: ["stock audit", "shortcut", "enter", "audit"],
        blocks: [
          { type: "text", content: "On the Stock Audit detail page, where you enter physical counts row by row:" },
          { type: "shortcut", keys: ["Enter"],        desc: "Confirm the current row's count and jump to the next medicine" },
          { type: "tip", content: "Use Enter to move through rows quickly without touching the mouse — ideal when counting shelf by shelf." },
        ],
      },
      {
        id: "grn-shortcuts", question: "GRN (Gate Inward) shortcuts",
        tags: ["grn", "shortcut", "ctrl v", "paste", "import", "gate inward", "bulk import shortcut"],
        blocks: [
          { type: "text", content: "These shortcuts work inside the New GRN modal (Purchase → Gate Inward → New GRN)." },
          { type: "shortcut", keys: ["Ctrl", "V"], desc: "Paste copied Excel/Sheets cells to open the bulk import panel pre-loaded with your data" },
          { type: "tip", content: "Ctrl+V only triggers the importer when your cursor is NOT inside a text input. Click on any empty area of the modal first, then paste." },
        ],
      },
    ],
  },

  // ── Getting Started ────────────────────────────────────────────────────────
  {
    id: "start", label: "Getting Started", icon: Zap,
    color: "text-amber-600", bg: "bg-amber-50", activeBg: "bg-amber-500",
    items: [
      {
        id: "what-is", question: "What is Checkup Pharmacy OS?",
        tags: ["overview", "intro", "what is"],
        blocks: [
          { type: "text", content: "Checkup is an all-in-one pharmacy management platform built for Indian pharmacies. It covers billing, inventory, purchase, reports, customer management, and support — all from a single app, accessible from any browser." },
          {
            type: "grid", items: [
              { icon: Receipt,      label: "Billing",    desc: "GST invoices in seconds",          color: "bg-blue-100 text-blue-600"     },
              { icon: Package2,     label: "Inventory",  desc: "Batches, expiry & stock alerts",   color: "bg-emerald-100 text-emerald-600" },
              { icon: ShoppingCart, label: "Purchase",   desc: "Suppliers, POs & GRNs",            color: "bg-purple-100 text-purple-600"  },
              { icon: BarChart3,    label: "Reports",    desc: "Sales, GST & profit analytics",    color: "bg-rose-100 text-rose-600"     },
              { icon: Users,        label: "Customers",  desc: "Patient profiles & history",       color: "bg-teal-100 text-teal-600"     },
              { icon: TicketCheck,  label: "Support",    desc: "Raise & track help tickets",       color: "bg-indigo-100 text-indigo-600" },
            ],
          },
        ],
      },
      {
        id: "navigation", question: "How do I navigate the app?",
        tags: ["nav", "menu", "navigate", "how to"],
        blocks: [
          { type: "text", content: "The top navigation bar gives instant access to every module. Hover over each tab to see its sub-sections." },
          {
            type: "grid", items: [
              { icon: Receipt,      label: "Sales",     desc: "New bill, all bills, drafts, returns",      color: "bg-blue-100 text-blue-600"    },
              { icon: ShoppingCart, label: "Purchase",  desc: "Orders, GRNs, suppliers",                  color: "bg-purple-100 text-purple-600" },
              { icon: Package2,     label: "Inventory", desc: "Stock, locations, stock audit",             color: "bg-emerald-100 text-emerald-600" },
              { icon: Zap,          label: "More",      desc: "Customers, medicines, Ginni, quotations",   color: "bg-amber-100 text-amber-600"  },
            ],
          },
          { type: "shortcut", keys: ["Ctrl", "K"], desc: "Open global search from anywhere" },
          { type: "shortcut", keys: ["F2"],        desc: "Jump directly to New Bill screen" },
        ],
      },
      {
        id: "roles", question: "What are the staff roles and their access?",
        tags: ["roles", "staff", "permission", "access", "owner", "manager"],
        blocks: [
          { type: "text", content: "Each staff member has a role that controls what they can see and do inside Checkup." },
          {
            type: "badges", items: [
              { label: "Owner",         color: "bg-purple-100 text-purple-700", desc: "Full access — settings, staff, all reports, billing, inventory" },
              { label: "Manager",       color: "bg-blue-100 text-blue-700",     desc: "All operational access — billing, inventory, purchase, reports" },
              { label: "Pharmacist",    color: "bg-teal-100 text-teal-700",     desc: "Billing, dispensing medicines, inventory lookup" },
              { label: "Cashier",       color: "bg-amber-100 text-amber-700",   desc: "Billing only — create and print invoices" },
              { label: "Support Agent", color: "bg-indigo-100 text-indigo-700", desc: "Platform support staff — manages pharmacy support tickets" },
            ],
          },
          { type: "tip", content: "Owners manage staff roles from Settings → Staff. A staff account cannot change its own role." },
        ],
      },
      {
        id: "shop-live", question: "What is the 'Shop Live' toggle?",
        tags: ["shop live", "online", "toggle", "open", "closed"],
        blocks: [
          { type: "text", content: "'Shop Live' shows whether your pharmacy is currently open and accepting orders on any connected customer-facing platform (like a patient app or website)." },
          {
            type: "badges", items: [
              { label: "ON",  color: "bg-emerald-100 text-emerald-700", desc: "Pharmacy is open — customers can see you and place orders" },
              { label: "OFF", color: "bg-slate-100 text-slate-600",    desc: "Pharmacy is closed — no new orders will be accepted" },
            ],
          },
          { type: "tip", content: "Toggle it from the top navigation bar. Set it to OFF when you close for the day." },
        ],
      },
      {
        id: "notifications", question: "How do notifications work?",
        tags: ["notification", "bell", "alert", "notify"],
        blocks: [
          { type: "text", content: "The notification bell (🔔) in the top bar shows real-time in-app alerts. Notifications are sent when important events happen — like a staff login, a new support ticket update, or a system alert." },
          {
            type: "grid", items: [
              { icon: Users,        label: "Staff Login",   desc: "When a staff member logs in",           color: "bg-blue-100 text-blue-600"    },
              { icon: TicketCheck,  label: "Ticket Update", desc: "Agent replied to your support ticket",  color: "bg-indigo-100 text-indigo-600" },
              { icon: AlertTriangle,label: "Low Stock",     desc: "Medicine stock below reorder level",    color: "bg-amber-100 text-amber-600"  },
            ],
          },
        ],
      },
    ],
  },

  // ── Billing & Sales ────────────────────────────────────────────────────────
  {
    id: "billing", label: "Billing & Sales", icon: Receipt,
    color: "text-blue-600", bg: "bg-blue-50", activeBg: "bg-blue-600",
    items: [
      {
        id: "new-bill", question: "How do I create a new bill?",
        tags: ["bill", "invoice", "new", "create", "f2", "billing"],
        blocks: [
          { type: "text", content: "Checkup bills are designed for speed — complete a full GST invoice in under 30 seconds." },
          {
            type: "steps", steps: [
              "Press F2 or click 'New Bill' in the Sales dropdown",
              "Optionally search for a registered customer/patient",
              "Type the medicine name in the search box — results appear from your stock instantly",
              "Select the medicine; price, batch, MRP, and GST are auto-filled",
              "Enter the quantity; the system picks the right batch (FEFO — first-expiry-first-out)",
              "Add more medicines as needed",
              "Choose payment method (Cash / UPI / Card / Credit)",
              "Click 'Save & Print' to finalise and print the invoice",
            ],
          },
          { type: "shortcut", keys: ["F2"],          desc: "Open New Bill from anywhere" },
          { type: "shortcut", keys: ["Enter"],        desc: "Select the highlighted medicine in search" },
          { type: "tip", content: "You can search by brand name, generic name, or even a partial word. The system searches 50,000+ medicines from the national medicines database." },
        ],
      },
      {
        id: "draft", question: "What is a Draft Bill?",
        tags: ["draft", "save", "resume", "hold"],
        blocks: [
          { type: "text", content: "A Draft is an incomplete bill saved mid-way. It stays in Drafts until you complete or delete it — nothing is deducted from stock until the bill is finalised." },
          {
            type: "steps", steps: [
              "While creating a bill, click 'Save as Draft'",
              "Go to Sales → Draft Bills to see all drafts",
              "Click any draft to resume exactly where you left off",
              "Finalise it to deduct stock and generate the invoice",
            ],
          },
          { type: "tip", content: "Great for when a customer needs to check something or you get interrupted. Drafts have no time limit." },
        ],
      },
      {
        id: "return", question: "How do I process a Sales Return?",
        tags: ["return", "refund", "sales return", "reverse", "credit note", "restock", "writeoff", "disposition", "partial return"],
        blocks: [
          { type: "text", content: "A Sales Return lets you accept medicines back from a customer and issue a credit note. You control whether each returned item goes back into stock (Restock) or is discarded (Write-off)." },
          {
            type: "steps", steps: [
              "Open the original invoice — go to Sales → All Bills and click the bill",
              "Click the 'Process Return' button (red border) in the top-right",
              "Set the return quantity for each medicine — use +/– or type directly (max = qty sold)",
              "For each item choose a disposition: Restock or Write-off",
              "Type a return reason in the text box (required, e.g. 'Patient didn't need it')",
              "Click Submit — a credit note number is generated instantly",
            ],
          },
          {
            type: "badges", items: [
              { label: "Restock ↩",   color: "bg-emerald-100 text-emerald-700", desc: "Medicine goes back into inventory — use for sealed, unopened packs" },
              { label: "Write-off ✕", color: "bg-red-100 text-red-700",         desc: "Medicine is discarded — use for opened, damaged, or unusable packs" },
            ],
          },
          { type: "tip", content: "You can do a partial return — return only some items from the bill. The invoice shows Partially Returned. You can return the remaining items later." },
          { type: "warning", content: "Returns are only accepted within the return window (default 30 days, configurable in Settings). If the original bill was a credit sale and unpaid, the customer's credit limit is freed up automatically on return." },
        ],
      },
      {
        id: "gst", question: "How does GST work in billing?",
        tags: ["gst", "tax", "gstin", "rate", "hsn", "slab"],
        blocks: [
          { type: "text", content: "GST is automatically applied to every medicine based on its HSN code and government-mandated slab. You never need to set GST manually." },
          {
            type: "badges", items: [
              { label: "0%",  color: "bg-slate-100 text-slate-700",   desc: "Life-saving drugs, essential medicines (blood, insulin, etc.)" },
              { label: "5%",  color: "bg-green-100 text-green-700",   desc: "Most common OTC and prescription medicines" },
              { label: "12%", color: "bg-amber-100 text-amber-700",   desc: "Formulations, some Ayurvedic & nutraceutical products" },
              { label: "18%", color: "bg-orange-100 text-orange-700", desc: "Medical devices, surgical items, some supplements" },
            ],
          },
          { type: "tip", content: "The GST report under Reports gives you a month-wise input/output tax summary ready for filing on the GST portal." },
        ],
      },
      {
        id: "lifa-lila", question: "What is LIFA / LILA batch selection?",
        tags: ["lifa", "lila", "batch", "newest", "oldest", "fefo", "lifo"],
        blocks: [
          { type: "text", content: "LIFA and LILA control which batch is auto-selected when you add a medicine that exists in multiple batches." },
          {
            type: "badges", items: [
              { label: "LIFA", color: "bg-blue-100 text-blue-700",  desc: "Last In, First Available — newest batch dispensed first. Useful for fast-moving medicines where the latest stock is most trusted." },
              { label: "LILA", color: "bg-slate-100 text-slate-700", desc: "Last In, Last Available — oldest batch dispensed first (FEFO behaviour). Recommended to minimise expiry losses." },
            ],
          },
          { type: "tip", content: "Toggle LIFA/LILA from the small button on the billing sub-navigation bar. Hover it to see which mode is active. LILA (FEFO) is the safer default for most pharmacies." },
        ],
      },
      {
        id: "invoice-settings", question: "How do I customise my invoices?",
        tags: ["invoice", "print", "logo", "customise", "header"],
        blocks: [
          { type: "text", content: "You can customise the printed invoice with your pharmacy's logo, DL number, GSTIN, address, and footer message." },
          {
            type: "steps", steps: [
              "Go to Settings → Invoice Settings",
              "Upload your pharmacy logo",
              "Set the invoice header (pharmacy name, address, phone, GSTIN, DL number)",
              "Add a footer message (e.g. 'Thank you for your purchase')",
              "Choose paper size (A4 / 80mm thermal)",
              "Save — all new bills will use the updated format",
            ],
          },
        ],
      },
    ],
  },

  // ── Inventory ──────────────────────────────────────────────────────────────
  {
    id: "inventory", label: "Inventory", icon: Package2,
    color: "text-emerald-600", bg: "bg-emerald-50", activeBg: "bg-emerald-600",
    items: [
      {
        id: "batch", question: "What is a Batch Number?",
        tags: ["batch", "lot", "batch number", "manufacture"],
        blocks: [
          { type: "text", content: "A batch number (or lot number) is a unique code assigned by the manufacturer to a specific production run of a medicine. It lets you trace which batch was sold to which customer." },
          {
            type: "grid", items: [
              { icon: Tag,          label: "Traceability",  desc: "Know exactly which batch was dispensed",    color: "bg-blue-100 text-blue-600"   },
              { icon: AlertTriangle, label: "Drug Recall",  desc: "Quickly identify & quarantine bad batches",  color: "bg-red-100 text-red-600"    },
              { icon: Calendar,     label: "Expiry",        desc: "Each batch has its own expiry date",        color: "bg-amber-100 text-amber-600" },
              { icon: DollarSign,   label: "Cost Tracking", desc: "Purchase price recorded per batch",        color: "bg-emerald-100 text-emerald-600" },
            ],
          },
          { type: "tip", content: "Always enter the batch number when receiving stock through a GRN. It is printed on the medicine strip, box, or label." },
        ],
      },
      {
        id: "fefo", question: "What is FEFO and why does it matter?",
        tags: ["fefo", "first expiry", "batch selection", "expiry"],
        blocks: [
          { type: "text", content: "FEFO stands for First-Expiry-First-Out. When a medicine appears in multiple batches, Checkup automatically suggests the batch that expires soonest — ensuring older stock is sold first and waste is minimised." },
          { type: "tip", content: "Checkup applies FEFO automatically during billing. You can override the batch selection manually if needed." },
        ],
      },
      {
        id: "expiry", question: "How do expiry alerts work?",
        tags: ["expiry", "expire", "alert", "near expiry"],
        blocks: [
          { type: "text", content: "Checkup monitors expiry dates for every batch and proactively alerts you so you can act before medicines expire." },
          {
            type: "badges", items: [
              { label: "Critical — < 30 days",  color: "bg-red-100 text-red-700",    desc: "Return to distributor or apply urgent discount / quarantine" },
              { label: "Warning — 30–60 days",  color: "bg-amber-100 text-amber-700", desc: "Plan for return to supplier or run a promotion" },
              { label: "Upcoming — 60–90 days", color: "bg-blue-100 text-blue-700",   desc: "Keep an eye on; prioritise in billing" },
            ],
          },
          { type: "tip", content: "The Home dashboard shows expiry alerts. You can also filter the Inventory page by expiry date to see all affected batches at once." },
        ],
      },
      {
        id: "low-stock", question: "What is a Low Stock Alert?",
        tags: ["low stock", "reorder", "minimum", "alert"],
        blocks: [
          { type: "text", content: "When a medicine's stock quantity falls below the configured minimum (reorder level), it is flagged as low stock and appears on the Home dashboard and Inventory page." },
          {
            type: "steps", steps: [
              "Set the minimum stock level when adding a medicine to inventory",
              "Checkup monitors stock in real-time as bills are created",
              "Low stock items appear with a red badge in Inventory",
              "Click 'Reorder' on any low stock item to create a Purchase Order instantly",
            ],
          },
        ],
      },
      {
        id: "stock-audit", question: "What is a Stock Audit?",
        tags: ["stock audit", "audit", "physical count", "discrepancy"],
        blocks: [
          { type: "text", content: "A Stock Audit is a physical count of your shelves compared against the system's records. It finds discrepancies caused by breakage, pilferage, or data entry errors." },
          {
            type: "steps", steps: [
              "Go to Inventory → Stock Audit → Start New Audit",
              "Scan or search for each medicine and enter the physically counted quantity",
              "The system highlights items where physical count ≠ system count",
              "Review and adjust each discrepancy with a reason",
              "Finalise the audit to lock the record and update stock",
            ],
          },
          { type: "warning", content: "Run audits during off-peak hours. Once finalised, an audit cannot be edited. Adjustments affect your stock valuation." },
        ],
      },
      {
        id: "locations", question: "What are Locations, Racks, and Shelves?",
        tags: ["location", "rack", "shelf", "where", "storage"],
        blocks: [
          { type: "text", content: "Checkup lets you map your physical pharmacy layout — defining storage locations (racks, shelves, refrigerators) for each medicine. This speeds up dispensing by telling staff exactly where to find a medicine." },
          {
            type: "steps", steps: [
              "Go to Inventory → Locations to set up racks and shelves",
              "Assign a location to each medicine in inventory",
              "During billing, the location appears next to the medicine so staff know where to fetch it from",
            ],
          },
          { type: "tip", content: "Use meaningful names like 'Rack A – Shelf 2' or 'Fridge – Cold Storage' for easy identification." },
        ],
      },
    ],
  },

  // ── Purchase & Suppliers ───────────────────────────────────────────────────
  {
    id: "purchase", label: "Purchase", icon: ShoppingCart,
    color: "text-purple-600", bg: "bg-purple-50", activeBg: "bg-purple-600",
    items: [
      {
        id: "po", question: "What is a Purchase Order (PO)?",
        tags: ["purchase order", "po", "order", "supplier order"],
        blocks: [
          { type: "text", content: "A Purchase Order is a formal document sent to a supplier requesting medicines. It records what you ordered, how much, and at what agreed price." },
          {
            type: "steps", steps: [
              "Go to Purchase → New Order",
              "Select a supplier from your list",
              "Add medicines and quantities you want to order",
              "Save or send the PO to the supplier",
              "When stock arrives, convert the PO into a GRN (Goods Receipt Note)",
            ],
          },
          { type: "tip", content: "You can create a PO automatically from the low stock list — click 'Reorder' on any low-stock item." },
        ],
      },
      {
        id: "po-statuses", question: "What do the PO statuses mean? (Draft → Pending → Partial → Received)",
        tags: ["po status", "draft", "pending", "partial", "received", "cancelled", "purchase order status", "status change"],
        blocks: [
          { type: "text", content: "A Purchase Order moves through these stages from creation to completion. Stock is never affected until goods are physically received." },
          {
            type: "badges", items: [
              { label: "Draft",    color: "bg-slate-100 text-slate-700",   desc: "PO just created. You can still edit or delete it. Nothing has been sent to the supplier yet." },
              { label: "Pending",  color: "bg-amber-100 text-amber-700",   desc: "PO has been sent to the supplier. Editing is locked. Waiting for stock to arrive." },
              { label: "Partial",  color: "bg-blue-100 text-blue-700",     desc: "Some stock has arrived and been received via Gate Inward (GRN). More deliveries are expected." },
              { label: "Received", color: "bg-emerald-100 text-emerald-700", desc: "All stock has been received. PO is complete. Inventory is updated, supplier balance is added." },
              { label: "Cancelled",color: "bg-red-100 text-red-700",       desc: "PO was cancelled. Cannot cancel once stock has already been received." },
            ],
          },
          {
            type: "steps", steps: [
              "Create a PO → status is Draft",
              "Click 'Send' on the PO → status changes to Pending",
              "Stock arrives → go to Gate Inward → create and confirm a GRN → status becomes Partial",
              "All deliveries confirmed → status automatically becomes Received",
            ],
          },
          { type: "tip", content: "Stock is added to inventory only when a GRN is confirmed — not when the PO is created or sent." },
        ],
      },
      {
        id: "po-approval", question: "What is PO Approval and when is it needed?",
        tags: ["po approval", "pending approval", "approved", "rejected", "pharmacist", "owner approve"],
        blocks: [
          { type: "text", content: "If a Pharmacist creates a PO, the Owner must approve it before it can be sent to the supplier. This is a safety check so large orders don't go out without owner knowledge." },
          {
            type: "badges", items: [
              { label: "Not Required",      color: "bg-slate-100 text-slate-600",    desc: "PO created by Owner — no approval needed, can be sent immediately." },
              { label: "Pending Approval",  color: "bg-orange-100 text-orange-700",  desc: "PO created by Pharmacist — Owner needs to approve before it can be sent." },
              { label: "Approved",          color: "bg-emerald-100 text-emerald-700", desc: "Owner approved it — PO can now be sent to the supplier." },
              { label: "Rejected",          color: "bg-red-100 text-red-700",        desc: "Owner rejected it — PO cannot be sent. Edit and resubmit if needed." },
            ],
          },
          { type: "tip", content: "As an Owner, you will see 'Approve' and 'Reject' buttons on any PO created by your staff. Pending Approvals count is shown on the Purchase page summary bar." },
        ],
      },
      {
        id: "po-send", question: "How do I send a PO to my supplier?",
        tags: ["send po", "share po", "whatsapp po", "pdf po", "download po", "po supplier", "send purchase order", "mark as sent"],
        blocks: [
          { type: "text", content: "When a Draft PO is ready, click the 'Send' button on the PO row. A panel slides in with three ways to share the order — no email service needed." },
          {
            type: "grid", items: [
              { icon: FileText,    label: "Download PDF",      desc: "Opens a print-ready A4 document. Choose 'Save as PDF' and email it yourself.",              color: "bg-blue-100 text-blue-600"    },
              { icon: Phone,       label: "Share on WhatsApp", desc: "Opens WhatsApp with the PO details pre-filled. Just hit Send.",                            color: "bg-emerald-100 text-emerald-600" },
              { icon: CheckCircle2, label: "Mark as Sent",     desc: "If you already shared it another way, use this to move the PO to Pending without sharing.", color: "bg-slate-100 text-slate-600"   },
            ],
          },
          {
            type: "steps", steps: [
              "Go to Purchase → Orders and find a Draft PO",
              "Hover over the row — the 'Send' button appears in the Actions column",
              "Click 'Send' — the share panel slides in and loads the PO details",
              "Choose Download PDF → save as PDF → email it to your supplier yourself",
              "Or choose Share on WhatsApp → the message is pre-filled, just tap Send",
              "The PO status changes to Pending automatically when you take any action",
            ],
          },
          { type: "tip", content: "The PDF includes your pharmacy letterhead, GSTIN, Drug License, supplier details, item-wise breakdown, GST amounts, and a signature block — ready to send or print." },
          { type: "warning", content: "Once you click Send (any option), the PO moves to Pending and is locked for editing. Double-check quantities and prices before sharing." },
        ],
      },
      {
        id: "po-send-pdf", question: "How does the PDF / Print option work?",
        tags: ["pdf", "print po", "save pdf", "download po", "po document", "letterhead"],
        blocks: [
          { type: "text", content: "Clicking 'Download PDF' opens a formatted purchase order in a new browser tab and auto-triggers the print dialog. From there you can save it as a PDF file." },
          {
            type: "steps", steps: [
              "Click 'Send' on the Draft PO row",
              "In the panel, click 'Download PDF'",
              "A new tab opens with the formatted PO document",
              "The browser print dialog opens automatically",
              "Change the destination to 'Save as PDF'",
              "Save the file and email it to your supplier from your Gmail or Outlook",
            ],
          },
          { type: "tip", content: "The document is formatted for A4 paper and includes: pharmacy name, address, GSTIN, Drug License, supplier name, all ordered medicines with batch/expiry/MRP, subtotal, GST breakdown, grand total, and an authorised signatory block." },
          { type: "warning", content: "If the print dialog does not open automatically, your browser may have blocked the pop-up. Click 'Allow' on the pop-up blocked notification in the address bar and try again." },
        ],
      },
      {
        id: "po-send-whatsapp", question: "How does the WhatsApp share option work?",
        tags: ["whatsapp", "share", "wp", "wa", "whatsapp po", "message supplier"],
        blocks: [
          { type: "text", content: "Clicking 'Share on WhatsApp' opens WhatsApp Web (or your WhatsApp app) with a pre-written message already filled in. The supplier's phone number is picked automatically from their profile." },
          {
            type: "steps", steps: [
              "Click 'Send' on the Draft PO row",
              "In the panel, click 'Share on WhatsApp'",
              "WhatsApp opens in a new tab with the supplier's number pre-filled",
              "The message includes PO number, date, expected delivery, total amount, and a confirmation request",
              "Just click 'Send' in WhatsApp — no typing needed",
            ],
          },
          { type: "tip", content: "Make sure the supplier's phone number is saved in their profile (Purchase → Suppliers → Edit). The WhatsApp button is greyed out if there is no phone number on file." },
          { type: "warning", content: "WhatsApp does not support sending files via URL links. The message is text-only. If you need to send the full PDF, use the Download PDF option and attach it manually to a WhatsApp chat." },
        ],
      },
      {
        id: "grn", question: "What is a GRN (Goods Receipt Note)?",
        tags: ["grn", "goods receipt", "inward", "receive stock"],
        blocks: [
          { type: "text", content: "A GRN is created when you physically receive medicines from a supplier. It adds the stock to your inventory, records the batch number, expiry date, and purchase price." },
          {
            type: "grid", items: [
              { icon: Truck,       label: "Stock Added",    desc: "Inventory is updated automatically",     color: "bg-emerald-100 text-emerald-600" },
              { icon: Tag,         label: "Batch Captured", desc: "Batch no. & expiry date recorded",      color: "bg-blue-100 text-blue-600"    },
              { icon: CreditCard,  label: "Payment Due",    desc: "Amount owed to supplier tracked",       color: "bg-purple-100 text-purple-600"  },
              { icon: Hash,        label: "PO Linked",      desc: "GRN auto-links to the original PO",     color: "bg-slate-100 text-slate-600"  },
            ],
          },
          { type: "tip", content: "You can add medicines one by one, or import a full invoice from Excel/Google Sheets in seconds — press Ctrl+V anywhere on the GRN screen with cells copied." },
          { type: "warning", content: "Always verify the physical quantities against the supplier's invoice before confirming the GRN. Short deliveries or damaged items should be noted immediately." },
        ],
      },
      {
        id: "grn-bulk-import", question: "How do I import medicines into a GRN from Excel or CSV?",
        tags: ["grn", "bulk import", "excel", "csv", "paste", "ctrl v", "import medicines", "spreadsheet", "column mapping", "distributor invoice", "copy paste"],
        blocks: [
          { type: "text", content: "Instead of entering medicines one by one, you can paste an entire supplier invoice from Excel or Google Sheets directly into the GRN screen. The system reads your columns automatically and maps them to the right fields." },
          {
            type: "steps", steps: [
              "Open a new GRN (Purchase → Gate Inward → New GRN)",
              "In Excel or Google Sheets, select all the rows of your invoice and press Ctrl+C",
              "Switch to the GRN screen and press Ctrl+V anywhere (not inside a text box) — the import panel opens instantly with your data pre-loaded",
              "Alternatively, click the 'Import from Excel, CSV or paste' button to open the panel and paste or drag a CSV file",
              "The column mapper auto-detects Medicine Name, Batch, Expiry, Qty, Rate, MRP, GST and highlights any it couldn't recognise",
              "Use the dropdowns in the mapper to assign any unrecognised columns manually",
              "The preview table shows a sample of valid rows and lists any rows with errors (e.g. missing name, invalid rate)",
              "Click 'Add X medicines to GRN' — all valid rows are added to the GRN table instantly",
            ],
          },
          { type: "tip", content: "The importer recognises 50+ column name variants used by Indian distributors — PTR, P. Rate, P/Rate, Drug Name, Particulars, Batch No., Exp. Date, Exp(MM/YYYY), IGST, M.R.P., Disc%, Bonus Qty, and more. Most invoices work without any manual mapping." },
          { type: "shortcut", keys: ["Ctrl", "V"], desc: "Paste copied Excel/Sheets cells anywhere on the GRN screen to open the bulk import panel" },
          { type: "warning", content: "If any medicines are expiring within 90 days, a near-expiry warning banner appears before the GRN is saved. Click 'Accept & Save GRN' to confirm you are aware and want to proceed, or go back and remove those items." },
        ],
      },
      {
        id: "grn-near-expiry", question: "What happens when a GRN has near-expiry medicines?",
        tags: ["grn", "near expiry", "expiry warning", "90 days", "accept", "override", "near expiry grn"],
        blocks: [
          { type: "text", content: "When you try to save a GRN that contains medicines expiring within 90 days, Checkup blocks the save and shows a near-expiry warning. This is a safety check to prevent accidentally receiving stock that will expire before it can be sold." },
          {
            type: "badges", items: [
              { label: "< 90 days",  color: "bg-amber-100 text-amber-700", desc: "Near-expiry warning shown — you must explicitly accept before saving" },
              { label: "≥ 90 days",  color: "bg-emerald-100 text-emerald-700", desc: "Normal save — no warning, GRN is created immediately" },
            ],
          },
          {
            type: "steps", steps: [
              "Fill in the GRN and click 'Save GRN'",
              "If any item expires within 90 days, a warning card appears listing the affected medicines and their expiry dates",
              "Review the list — decide if you want to accept the stock or negotiate a return with the supplier",
              "Click 'Accept & Save GRN' to acknowledge and save the GRN as-is",
              "Or go back and delete the near-expiry rows from the table, then save normally",
            ],
          },
          { type: "tip", content: "The near-expiry rows are highlighted in orange in the GRN table so you can spot them easily even before saving." },
        ],
      },
      {
        id: "supplier", question: "How do I manage suppliers?",
        tags: ["supplier", "distributor", "vendor", "manage"],
        blocks: [
          { type: "text", content: "The Suppliers section lists all your medicine distributors and wholesale vendors. You can view their contact details, outstanding balances, and purchase history." },
          {
            type: "steps", steps: [
              "Go to Purchase → Suppliers to view all suppliers",
              "Click 'Add Supplier' to register a new distributor",
              "Fill in name, GSTIN, contact person, phone, and address",
              "Each GRN you create against a supplier creates a payment due record",
              "Record payments from the supplier's profile page",
            ],
          },
        ],
      },
      {
        id: "supplier-payment", question: "How do supplier payments work?",
        tags: ["payment", "outstanding", "credit", "supplier payment"],
        blocks: [
          { type: "text", content: "Every GRN creates an outstanding balance (payable) against the supplier. You can pay in full or in instalments. The system tracks what you owe at all times." },
          {
            type: "steps", steps: [
              "Go to Purchase → Suppliers and select a supplier",
              "View their outstanding balance at the top",
              "Click 'Record Payment'",
              "Enter the amount, date, and payment mode (cash / bank / cheque)",
              "The outstanding amount reduces immediately",
            ],
          },
          { type: "tip", content: "The Purchase Report shows you supplier-wise payable balances so you can plan your cash flow." },
        ],
      },
      {
        id: "supplier-return", question: "How do I return stock to a supplier?",
        tags: ["supplier return", "return to supplier", "debit note", "damaged stock", "near expiry return", "wrong product", "sr"],
        blocks: [
          { type: "text", content: "When medicines are damaged, near-expiry, expired, or incorrectly supplied, you can return them to the distributor. Checkup creates a Supplier Return (Debit Note) and reduces the amount you owe that supplier." },
          {
            type: "steps", steps: [
              "Go to Purchase → Returns tab",
              "Click 'New Return' and select the supplier",
              "Optionally enter the supplier's Debit Note number",
              "Add medicines to return — scan a barcode, pick from inventory batches, copy from last purchase, or import from CSV",
              "For each item set the quantity and pick a reason (Damaged, Near Expiry, Expired, Wrong Product, etc.)",
              "Save the return as Draft, then click Confirm to finalise",
            ],
          },
          {
            type: "badges", items: [
              { label: "Draft",     color: "bg-slate-100 text-slate-700",    desc: "Saved but not confirmed. You can still edit or cancel." },
              { label: "Confirmed", color: "bg-emerald-100 text-emerald-700", desc: "Finalised — stock deducted and supplier balance reduced." },
              { label: "Cancelled", color: "bg-red-100 text-red-700",        desc: "Cancelled before confirming. No inventory or balance change." },
            ],
          },
          { type: "tip", content: "Confirming a supplier return automatically reduces the outstanding balance you owe that supplier — you don't need to record a separate payment." },
          { type: "warning", content: "There is no return window for supplier returns. However, confirm only after you have physically dispatched the goods — confirming immediately deducts the stock from inventory." },
        ],
      },
      {
        id: "quotations", question: "What are Quotations?",
        tags: ["quotation", "quote", "price compare", "rfq"],
        blocks: [
          { type: "text", content: "Quotations let you request prices from multiple suppliers for the same medicine, then compare and select the best deal before placing a purchase order." },
          {
            type: "steps", steps: [
              "Go to More → Quotations → New Quotation",
              "Add the medicines you need and the quantity",
              "Send the quotation request to multiple suppliers",
              "Suppliers respond with their prices",
              "Compare prices side by side and convert the best quote to a Purchase Order",
            ],
          },
          { type: "tip", content: "Ideal for bulk purchases, slow-moving items, or medicines where prices vary significantly between distributors." },
        ],
      },
    ],
  },

  // ── Customers & Operations ─────────────────────────────────────────────────
  {
    id: "operations", label: "Operations", icon: Users,
    color: "text-teal-600", bg: "bg-teal-50", activeBg: "bg-teal-600",
    items: [
      {
        id: "customers", question: "What is the Customers module?",
        tags: ["customer", "patient", "profile", "history"],
        blocks: [
          { type: "text", content: "The Customers module lets you maintain a database of your regular patients. Each customer profile stores their contact details, prescription history, and purchase history." },
          {
            type: "grid", items: [
              { icon: Users,    label: "Profile",   desc: "Name, phone, age, blood group",    color: "bg-teal-100 text-teal-600"    },
              { icon: Receipt,  label: "Purchases", desc: "Full billing history",             color: "bg-blue-100 text-blue-600"   },
              { icon: FileText, label: "Rx History", desc: "Saved prescriptions",             color: "bg-purple-100 text-purple-600" },
              { icon: Bell,     label: "Reminders", desc: "Medication refill nudges",         color: "bg-amber-100 text-amber-600" },
            ],
          },
          {
            type: "steps", steps: [
              "Go to More → Customers to browse your customer list",
              "Click 'Add Customer' to register a new patient",
              "When billing, search the customer's name to attach the bill to their profile",
              "View a customer's full purchase and prescription history from their profile",
            ],
          },
        ],
      },
      {
        id: "calendar", question: "What is the Calendar?",
        tags: ["calendar", "events", "reminder", "schedule"],
        blocks: [
          { type: "text", content: "The Calendar helps you track pharmacy-related events and tasks — staff schedules, medicine delivery dates, license renewal deadlines, and custom reminders." },
          {
            type: "steps", steps: [
              "Click the Calendar button in the top navigation bar",
              "Click any date to add a new event",
              "Set the event title, time, and category (delivery, reminder, meeting, etc.)",
              "Today's events count shows as a badge on the Calendar button",
            ],
          },
          { type: "tip", content: "Use it to track drug license renewal dates, GSTIN filing deadlines, or scheduled distributor visits." },
        ],
      },
      {
        id: "medicines-catalogue", question: "What is the Medicines Catalogue?",
        tags: ["medicines", "catalogue", "database", "search", "50000"],
        blocks: [
          { type: "text", content: "The Medicines Catalogue is a pre-loaded database of 50,000+ medicines with their generic names, HSN codes, compositions, manufacturer details, and standard MRP." },
          {
            type: "steps", steps: [
              "Go to More → Medicines to browse the catalogue",
              "Search by brand name, generic name, or composition",
              "View a medicine's full details — composition, pack size, manufacturer, category",
              "Add a medicine from the catalogue directly to your inventory",
            ],
          },
          { type: "tip", content: "Medicines in the catalogue have GST rates and HSN codes pre-filled. Adding them to inventory avoids manual data entry errors." },
        ],
      },
      {
        id: "doctors", question: "What is the Doctors module?",
        tags: ["doctors", "prescription", "dr", "physician", "prescription link"],
        blocks: [
          { type: "text", content: "The Doctors module maintains a master list of prescribing physicians associated with your pharmacy. Linking a doctor to a bill helps with prescription tracking, Schedule H compliance, and generating doctor-wise sales reports." },
          {
            type: "steps", steps: [
              "Go to More → Doctors to view all registered doctors",
              "Click 'Add Doctor' and enter name, qualification, registration number, and clinic address",
              "When creating a bill, start typing in the Doctor field to search and attach a doctor",
              "Bills with a doctor linked can optionally store the Rx (prescription) number",
            ],
          },
          { type: "tip", content: "For Schedule H & H1 medicines, you must record the doctor's name and Rx number on every bill. The Doctors module makes this fast — just search and select." },
        ],
      },
      {
        id: "cash-closure", question: "What is Cash Closure?",
        tags: ["cash closure", "day end", "eod", "cash reconciliation", "closing"],
        blocks: [
          { type: "text", content: "Cash Closure is the end-of-day process where you reconcile the actual cash in your drawer against the expected cash from today's bills. It creates a locked daily cash record for your accounts." },
          {
            type: "steps", steps: [
              "Go to More → Cash Closure at the end of each working day",
              "The system shows expected cash (total cash-mode bills for the day)",
              "Count the physical cash in your drawer and enter the actual amount",
              "Any difference (short or excess) is recorded with a reason",
              "Confirm the closure — the day is locked and cannot be edited",
            ],
          },
          { type: "warning", content: "Once a cash closure is confirmed it cannot be undone. Make sure your count is correct before submitting." },
          { type: "tip", content: "Run Cash Closure every evening. It makes monthly accounting and audit much easier." },
        ],
      },
      {
        id: "ginni", question: "What is Ginni AI?",
        tags: ["ginni", "ai", "assistant", "chatbot", "artificial intelligence"],
        blocks: [
          { type: "text", content: "Ginni is Checkup's built-in AI assistant powered by advanced language models. It can answer questions about medicines, drug interactions, dosages, substitutes, and pharmacy operations." },
          {
            type: "grid", items: [
              { icon: FlaskConical, label: "Drug Info",      desc: "Composition, uses, side effects",          color: "bg-amber-100 text-amber-600"    },
              { icon: AlertTriangle,label: "Interactions",   desc: "Drug-drug interaction warnings",           color: "bg-red-100 text-red-600"       },
              { icon: Package2,     label: "Substitutes",    desc: "Generic alternatives at lower cost",       color: "bg-emerald-100 text-emerald-600" },
              { icon: BookOpen,     label: "Dosage",         desc: "Standard dosage guidance by indication",   color: "bg-blue-100 text-blue-600"      },
            ],
          },
          { type: "tip", content: "Access Ginni from the 'More' menu or the Ginni icon in the nav. Type your question in natural language — Hindi or English." },
          { type: "warning", content: "Ginni provides general medical information only. Always use clinical judgement and refer to a licensed prescriber for patient-specific decisions." },
        ],
      },
      {
        id: "vitacoin", question: "What are VitalCoins?",
        tags: ["vitacoin", "coins", "reward", "points"],
        blocks: [
          { type: "text", content: "VitalCoins are reward points earned for actively using Checkup features — billing, maintaining inventory, completing audits, referring other pharmacies, etc." },
          {
            type: "badges", items: [
              { label: "Earn",   color: "bg-amber-100 text-amber-700",   desc: "By billing, auditing stock, referring pharmacies, and completing profile setup" },
              { label: "Redeem", color: "bg-emerald-100 text-emerald-700", desc: "Against your subscription fee or to unlock premium features" },
            ],
          },
          { type: "tip", content: "Check your VitalCoin balance from the profile dropdown → VitalCoins." },
        ],
      },
    ],
  },

  // ── Reports ────────────────────────────────────────────────────────────────
  {
    id: "reports", label: "Reports", icon: BarChart3,
    color: "text-rose-600", bg: "bg-rose-50", activeBg: "bg-rose-600",
    items: [
      {
        id: "reports-overview", question: "What reports are available?",
        tags: ["reports", "analytics", "types"],
        blocks: [
          { type: "text", content: "Reports give you a complete financial and operational picture of your pharmacy. All reports support custom date range filtering." },
          {
            type: "grid", items: [
              { icon: TrendingUp,   label: "Sales Summary",   desc: "Revenue by day, week, month",          color: "bg-blue-100 text-blue-600"    },
              { icon: Receipt,      label: "GST Report",      desc: "Input/output tax for GST filing",      color: "bg-orange-100 text-orange-600" },
              { icon: Package2,     label: "Stock Report",    desc: "Current inventory valuation",          color: "bg-emerald-100 text-emerald-600" },
              { icon: Truck,        label: "Purchase Report", desc: "Supplier-wise purchase history",       color: "bg-purple-100 text-purple-600"  },
              { icon: RotateCcw,    label: "Returns Report",  desc: "All sales returns and refunds",        color: "bg-rose-100 text-rose-600"    },
              { icon: Users,        label: "Staff Report",    desc: "Bills & revenue per staff member",     color: "bg-teal-100 text-teal-600"    },
            ],
          },
        ],
      },
      {
        id: "eod", question: "What is the End of Day (EOD) Summary?",
        tags: ["eod", "end of day", "closing", "daily summary"],
        blocks: [
          { type: "text", content: "The EOD Summary is a daily snapshot of your pharmacy's performance — total sales, number of bills, cash vs. non-cash collections, top-selling medicines, and returns." },
          {
            type: "grid", items: [
              { icon: DollarSign,   label: "Total Sales",  desc: "Revenue for the day (incl. GST)",    color: "bg-blue-100 text-blue-600"    },
              { icon: Receipt,      label: "Total Bills",  desc: "Number of invoices created",          color: "bg-purple-100 text-purple-600" },
              { icon: TrendingUp,   label: "Top Medicines",desc: "Most-sold products of the day",       color: "bg-emerald-100 text-emerald-600" },
              { icon: RotateCcw,    label: "Returns",      desc: "Return value for the day",            color: "bg-rose-100 text-rose-600"    },
            ],
          },
          { type: "tip", content: "The EOD Summary is visible on the Home dashboard. Check it every evening before closing for the day." },
        ],
      },
      {
        id: "gst-report", question: "How do I use the GST Report for filing?",
        tags: ["gst report", "filing", "gstr", "input tax", "output tax"],
        blocks: [
          { type: "text", content: "The GST Report gives you a tax-wise breakup (0%, 5%, 12%, 18%) of all sales in a selected period — both output tax (collected from customers) and input tax (paid to suppliers)." },
          {
            type: "steps", steps: [
              "Go to Reports → GST Report",
              "Select the month/period",
              "The report shows taxable value and GST amount per slab",
              "Output tax = GST collected from customers (your liability)",
              "Input tax = GST paid on purchases (your credit)",
              "Net GST payable = Output tax – Input tax credit",
            ],
          },
          { type: "tip", content: "Export the report to share with your CA or accountant for GST return filing (GSTR-1, GSTR-3B)." },
        ],
      },
    ],
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  {
    id: "settings", label: "Settings", icon: Settings,
    color: "text-slate-600", bg: "bg-slate-100", activeBg: "bg-slate-700",
    items: [
      {
        id: "pharmacy-profile", question: "How do I update my pharmacy details?",
        tags: ["settings", "profile", "pharmacy", "address", "update"],
        blocks: [
          { type: "text", content: "Your pharmacy details (name, address, GSTIN, Drug License, phone, email, logo) are used on every invoice and in communications. Keep them accurate and up to date." },
          {
            type: "steps", steps: [
              "Go to Settings → Pharmacy Profile",
              "Update name, address, city, state, pincode",
              "Enter or update GSTIN and Drug License Number",
              "Upload your pharmacy logo (appears on printed invoices)",
              "Save changes",
            ],
          },
          { type: "tip", content: "Only the Owner role can edit the pharmacy profile." },
        ],
      },
      {
        id: "staff-management", question: "How do I add or manage staff?",
        tags: ["staff", "add staff", "employee", "password", "invite"],
        blocks: [
          { type: "text", content: "Add your pharmacists, cashiers, and managers as staff accounts so each person logs in with their own credentials." },
          {
            type: "steps", steps: [
              "Go to Settings → Staff",
              "Click 'Add Staff Member'",
              "Enter their name, email, phone, and assign a role",
              "They receive a temporary password (or set one for them)",
              "They log in at the same login page — their role controls their access",
            ],
          },
          {
            type: "badges", items: [
              { label: "Active",   color: "bg-emerald-100 text-emerald-700", desc: "Staff can log in and use the app" },
              { label: "Inactive", color: "bg-red-100 text-red-700",         desc: "Access blocked — staff cannot log in" },
            ],
          },
          { type: "tip", content: "Deactivate (don't delete) a staff account when someone leaves. This preserves all their billing history." },
        ],
      },
      {
        id: "change-password", question: "How do I change my password?",
        tags: ["password", "change password", "security", "reset"],
        blocks: [
          { type: "text", content: "Any user can change their own login password from the account settings." },
          {
            type: "steps", steps: [
              "Go to Settings → Change Password",
              "Enter your current password",
              "Enter the new password (minimum 8 characters)",
              "Confirm the new password",
              "Save — you will be asked to log in again with the new password",
            ],
          },
          { type: "tip", content: "If you forgot your password, use 'Forgot Password' on the login page. A reset link will be sent to your registered email." },
        ],
      },
      {
        id: "billing-prefs", question: "What are Billing Preferences?",
        tags: ["billing preferences", "save action", "default", "print"],
        blocks: [
          { type: "text", content: "Billing Preferences let you configure what happens when you click 'Save' on a bill — whether it saves silently, prints, opens a WhatsApp message, etc." },
          {
            type: "steps", steps: [
              "Go to Settings → Billing Preferences",
              "Choose your default Save action (Save, Save & Print, Save & WhatsApp, etc.)",
              "Set your preferred paper size for printing",
              "Save — your default now applies to every new bill",
            ],
          },
          { type: "tip", content: "You can also change the Save action on the fly from the dropdown arrow next to the Save button on the billing screen." },
        ],
      },
    ],
  },

  // ── Support Tickets ────────────────────────────────────────────────────────
  {
    id: "support", label: "Support", icon: TicketCheck,
    color: "text-indigo-600", bg: "bg-indigo-50", activeBg: "bg-indigo-600",
    items: [
      {
        id: "raise-ticket", question: "How do I raise a support ticket?",
        tags: ["ticket", "support", "help", "raise", "issue", "problem"],
        blocks: [
          { type: "text", content: "If you face any issue with the software, raise a support ticket. Our team will be assigned to your ticket via round-robin and will respond to help you resolve it." },
          {
            type: "steps", steps: [
              "Click your profile → Support Tickets, or click 'Raise Ticket' below",
              "Select the category that best matches your issue",
              "If you select 'Other', enter a short custom title",
              "Describe the problem clearly in the description box",
              "Enter your contact mobile number",
              "Choose your preferred language (Hindi or English)",
              "Optionally attach a screenshot or screen recording",
              "Submit — you'll get a ticket number immediately",
            ],
          },
          { type: "tip", content: "The more detail you provide upfront, the faster the issue gets resolved. Screenshots and screen recordings are the most helpful." },
        ],
      },
      {
        id: "ticket-status", question: "What do ticket statuses mean?",
        tags: ["ticket", "status", "open", "resolved", "in progress", "pending"],
        blocks: [
          { type: "text", content: "Your ticket moves through stages as the support team works on it. You can track the status on the Support Tickets page." },
          {
            type: "badges", items: [
              { label: "OPEN",          color: "bg-amber-100 text-amber-700",    desc: "Submitted — awaiting assignment to a support agent" },
              { label: "ASSIGNED",      color: "bg-blue-100 text-blue-700",      desc: "An agent has been assigned and will contact you soon" },
              { label: "IN PROGRESS",   color: "bg-indigo-100 text-indigo-700",  desc: "Agent is actively investigating and working on a fix" },
              { label: "PENDING USER",  color: "bg-orange-100 text-orange-700",  desc: "Agent needs more info from you — open the ticket and reply" },
              { label: "RESOLVED",      color: "bg-emerald-100 text-emerald-700",desc: "Issue fixed — ticket closes automatically after 48 hours" },
              { label: "CLOSED",        color: "bg-slate-100 text-slate-600",    desc: "Ticket is closed. Raise a new one if the issue recurs" },
            ],
          },
          { type: "tip", content: "If your ticket is in 'Pending User' status, open it and reply with the information the agent asked for. Tickets with no response for 7 days are auto-closed." },
        ],
      },
      {
        id: "screen-recording", question: "How do I record my screen for a ticket?",
        tags: ["screen recording", "recording", "capture", "video", "attach"],
        blocks: [
          { type: "text", content: "The built-in screen recorder lets you show the exact problem without any external software. The recording is attached directly to your ticket." },
          {
            type: "steps", steps: [
              "Open the New Ticket form",
              "Scroll to 'Screen Recording' section",
              "Click 'Start Recording' — your browser will ask which screen or window to share",
              "Reproduce the issue while the recording runs",
              "Click 'Stop Recording' when done",
              "A preview appears — you can discard and re-record if needed",
              "Submit the ticket — the recording is uploaded automatically",
            ],
          },
          { type: "warning", content: "Allow 'Screen Sharing' permission when your browser asks. The recording captures only the screen — not your camera or microphone." },
        ],
      },
      {
        id: "ticket-categories", question: "What are the support ticket categories?",
        tags: ["category", "billing", "inventory", "technical", "account"],
        blocks: [
          { type: "text", content: "Choose the category that best matches your issue so it reaches the right person faster." },
          {
            type: "badges", items: [
              { label: "Billing & Payments",  color: "bg-blue-100 text-blue-700",    desc: "Invoice issues, GST errors, payment recording" },
              { label: "Inventory & Stock",   color: "bg-emerald-100 text-emerald-700", desc: "Stock discrepancies, batch issues, expiry problems" },
              { label: "Medicine Search",     color: "bg-purple-100 text-purple-700",  desc: "Can't find a medicine, wrong price or details" },
              { label: "Reports",             color: "bg-rose-100 text-rose-700",     desc: "Report data looks wrong, missing data, export issues" },
              { label: "Technical Issue",     color: "bg-red-100 text-red-700",       desc: "App not loading, slow performance, browser errors" },
              { label: "Account & Access",    color: "bg-amber-100 text-amber-700",   desc: "Login problems, password reset, role access issues" },
              { label: "Other",               color: "bg-slate-100 text-slate-600",   desc: "Anything that doesn't fit the above categories" },
            ],
          },
        ],
      },
    ],
  },

  // ── Glossary ───────────────────────────────────────────────────────────────
  {
    id: "glossary", label: "Glossary", icon: BookOpen,
    color: "text-slate-700", bg: "bg-slate-100", activeBg: "bg-slate-700",
    items: [
      {
        id: "gstin", question: "GSTIN — what is it?",
        tags: ["gstin", "gst", "tax", "registration number"],
        blocks: [
          { type: "text", content: "GSTIN (Goods and Services Tax Identification Number) is a 15-character unique code assigned to every GST-registered business in India by the government." },
          { type: "tip", content: "Format: 2-digit state code + 10-digit PAN + entity type + Z + checksum. Example: 27AABCU9603R1ZX. Enter yours in Settings → Pharmacy Profile." },
        ],
      },
      {
        id: "drug-license", question: "Drug License (DL) — what is it?",
        tags: ["drug license", "dl", "license", "permit"],
        blocks: [
          { type: "text", content: "A Drug License is a government permit required to legally stock, sell, or distribute medicines in India. It is issued by the State Drugs Control Authority. Your DL number must appear on every invoice you generate." },
          { type: "tip", content: "Enter your DL number in Settings → Pharmacy Profile → Drug License. It auto-prints on all your bills." },
        ],
      },
      {
        id: "mrp", question: "MRP — what is it?",
        tags: ["mrp", "maximum retail price", "price"],
        blocks: [
          { type: "text", content: "MRP (Maximum Retail Price) is the highest price at which a product can be legally sold to the end consumer. It is set by the manufacturer and printed on the packaging. Selling above MRP is a legal offence." },
          { type: "tip", content: "Checkup alerts you if you try to bill above the MRP of any medicine." },
        ],
      },
      {
        id: "hsn", question: "HSN Code — what is it?",
        tags: ["hsn", "harmonised", "code", "gst classification"],
        blocks: [
          { type: "text", content: "HSN (Harmonised System of Nomenclature) is a standardised numerical code (usually 6–8 digits) that classifies goods globally. For medicines, the HSN code determines the applicable GST slab." },
          { type: "tip", content: "Checkup's medicines database has HSN codes pre-filled for all 50,000+ medicines. You don't need to look them up manually." },
        ],
      },
      {
        id: "sku", question: "SKU — what is it?",
        tags: ["sku", "stock keeping unit", "product code"],
        blocks: [
          { type: "text", content: "SKU (Stock Keeping Unit) is a unique internal identifier for a specific product variant. In a pharmacy, different pack sizes or formulations of the same medicine have different SKUs." },
        ],
      },
      {
        id: "po-grn-diff", question: "PO vs GRN — what's the difference?",
        tags: ["po", "grn", "difference", "purchase order", "goods receipt"],
        blocks: [
          { type: "text", content: "A Purchase Order (PO) is what you send to a supplier — it's a request/order. A GRN (Goods Receipt Note) is what you create when the stock actually arrives. PO = intent; GRN = delivery." },
          {
            type: "badges", items: [
              { label: "PO",  color: "bg-purple-100 text-purple-700", desc: "Created before stock arrives — records what was ordered" },
              { label: "GRN", color: "bg-emerald-100 text-emerald-700", desc: "Created when stock arrives — adds items to inventory" },
            ],
          },
        ],
      },
      {
        id: "fefo-term", question: "FEFO — what does it mean?",
        tags: ["fefo", "first expiry first out", "stock rotation"],
        blocks: [
          { type: "text", content: "FEFO stands for First-Expiry-First-Out. It is the principle of always selling the batch that expires soonest before a newer batch. This minimises medicine wastage due to expiry. Checkup applies this automatically during billing." },
        ],
      },
      {
        id: "round-robin", question: "Round-robin assignment — what is it?",
        tags: ["round robin", "assignment", "support", "distribution"],
        blocks: [
          { type: "text", content: "Round-robin is a fair ticket distribution method. When you raise a support ticket, it is automatically assigned to the support agent who was least-recently assigned — ensuring no agent gets overwhelmed while others are idle." },
        ],
      },
    ],
  },
];

// ── Category colour helper ────────────────────────────────────────────────────
const CAT_ACTIVE_BG: Record<string, string> = {
  shortcuts:  "bg-blue-600",
  start:      "bg-amber-500",
  billing:    "bg-blue-600",
  inventory:  "bg-emerald-600",
  purchase:   "bg-purple-600",
  operations: "bg-teal-600",
  reports:    "bg-rose-600",
  settings:   "bg-slate-700",
  support:    "bg-indigo-600",
  glossary:   "bg-slate-700",
};

// ── Rich block renderers ──────────────────────────────────────────────────────

function RichContent({ blocks }: { blocks: RichBlock[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.type === "text") {
          return <p key={i} className="text-[13px] text-slate-600 leading-relaxed">{block.content}</p>;
        }
        if (block.type === "tip") {
          return (
            <div key={i} className="flex gap-2.5 p-2.5 bg-blue-50 rounded-xl border border-blue-100">
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Lightbulb className="w-2.5 h-2.5 text-white" />
              </div>
              <p className="text-[12px] text-blue-700 leading-relaxed">{block.content}</p>
            </div>
          );
        }
        if (block.type === "warning") {
          return (
            <div key={i} className="flex gap-2.5 p-2.5 bg-amber-50 rounded-xl border border-amber-100">
              <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertTriangle className="w-2.5 h-2.5 text-white" />
              </div>
              <p className="text-[12px] text-amber-700 leading-relaxed">{block.content}</p>
            </div>
          );
        }
        if (block.type === "steps") {
          return (
            <ol key={i} className="space-y-2">
              {block.steps.map((step, si) => (
                <li key={si} className="flex gap-2.5 items-start">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                    {si + 1}
                  </span>
                  <span className="text-[12.5px] text-slate-600 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          );
        }
        if (block.type === "badges") {
          return (
            <div key={i} className="space-y-2">
              {block.items.map((item, bi) => (
                <div key={bi} className="flex items-start gap-2.5">
                  <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 whitespace-nowrap", item.color)}>
                    {item.label}
                  </span>
                  <span className="text-[12px] text-slate-500 leading-relaxed">{item.desc}</span>
                </div>
              ))}
            </div>
          );
        }
        if (block.type === "shortcut") {
          return (
            <div key={i} className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center gap-1">
                {block.keys.map((k, ki) => (
                  <span key={ki} className="inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 bg-white border border-slate-300 rounded-md text-[11px] font-bold text-slate-700 shadow-sm font-mono">
                    {k}
                  </span>
                ))}
              </div>
              <span className="text-[12px] text-slate-500">{block.desc}</span>
            </div>
          );
        }
        if (block.type === "grid") {
          return (
            <div key={i} className="grid grid-cols-2 gap-2">
              {block.items.map((item, gi) => {
                const Icon = item.icon;
                return (
                  <div key={gi} className="flex items-start gap-2 p-2.5 bg-white rounded-xl border border-slate-100 shadow-sm">
                    <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", item.color)}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-slate-800 leading-tight">{item.label}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

// ── Accordion item ────────────────────────────────────────────────────────────

function HelpItemCard({ item }: { item: HelpItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn(
      "border rounded-xl overflow-hidden transition-colors duration-200",
      open ? "border-blue-200 shadow-sm" : "border-slate-100 hover:border-slate-200",
    )}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-white hover:bg-slate-50/80 transition-colors"
      >
        <span className={cn("text-[13px] font-semibold leading-snug", open ? "text-blue-700" : "text-slate-800")}>
          {item.question}
        </span>
        <ChevronDown className={cn("w-4 h-4 flex-shrink-0 transition-transform duration-200", open ? "rotate-180 text-blue-500" : "text-slate-400")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{   height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-3 bg-slate-50/60 border-t border-slate-100">
              <RichContent blocks={item.blocks} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function HelpWidget() {
  const toast                       = useToast();
  const [open,          setOpen]    = useState(false);
  const [activeCategory, setActiveCat] = useState("start");
  const [search,        setSearch]  = useState("");
  const [showTicket,    setShowTicket] = useState(false);
  const isAgent = isSupportStaff();

  const searchResults = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return null;
    const out: { cat: HelpCategory; item: HelpItem }[] = [];
    for (const cat of CATEGORIES) {
      for (const item of cat.items) {
        const hit =
          item.question.toLowerCase().includes(q) ||
          item.tags.some(t => t.includes(q)) ||
          item.blocks.some(b =>
            (b.type === "text" || b.type === "tip" || b.type === "warning") &&
            b.content.toLowerCase().includes(q),
          );
        if (hit) out.push({ cat, item });
      }
    }
    return out;
  }, [search]);

  const currentCat = CATEGORIES.find(c => c.id === activeCategory) ?? CATEGORIES[0]!;

  // Allow external triggers (e.g. "Shortcuts / Help" in profile menu) to open the widget
  useEffect(() => {
    const handler = (e: Event) => {
      const cat = (e as CustomEvent<{ category?: string }>).detail?.category;
      if (cat) setActiveCat(cat);
      setOpen(true);
    };
    window.addEventListener("checkup:open-help", handler as EventListener);
    return () => window.removeEventListener("checkup:open-help", handler as EventListener);
  }, []);

  function openTicket() {
    setOpen(false);
    setShowTicket(true);
  }

  return (
    <>
      {/* ── Floating bulb button ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          "fixed bottom-6 right-6 z-[60] w-13 h-13 rounded-2xl flex items-center justify-center transition-all duration-200",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2",
          open
            ? "w-11 h-11 bg-slate-700 hover:bg-slate-800"
            : "w-13 h-13 bg-gradient-to-br from-amber-400 to-orange-400 hover:from-amber-500 hover:to-orange-500 hover:scale-110 active:scale-95 shadow-2xl",
        )}
        aria-label={open ? "Close help" : "Open help & FAQ"}
        style={open ? undefined : { boxShadow: "0 8px 28px rgba(251,191,36,0.55), 0 2px 8px rgba(0,0,0,0.15)" }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {open
            ? <motion.span key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.12 }}>
                <X className="w-5 h-5 text-white" />
              </motion.span>
            : <motion.span key="bulb"  initial={{ rotate: 15, opacity: 0 }}  animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -15, opacity: 0 }} transition={{ duration: 0.12 }}>
                <Lightbulb className="w-6 h-6 text-white drop-shadow" />
              </motion.span>
          }
        </AnimatePresence>
      </button>

      {/* ── Help panel ── */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[55] bg-black/20 backdrop-blur-[2px] md:hidden"
            />

            <motion.aside
              initial={{ x: "100%", opacity: 0.6 }}
              animate={{ x: 0,      opacity: 1 }}
              exit={{   x: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="fixed right-0 top-0 bottom-0 z-[58] w-full sm:w-[430px] flex flex-col bg-white border-l border-slate-200 shadow-2xl"
            >
              {/* Header */}
              <div
                className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #0a1a52 0%, #162870 100%)" }}
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-400 flex items-center justify-center shadow-lg shadow-amber-500/30 flex-shrink-0">
                  <Lightbulb className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-[15px] font-black text-white leading-none">Help & Guide</h2>
                  <p className="text-[11px] text-white/50 mt-0.5 leading-none">FAQ, terms & how-tos</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Search */}
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex-shrink-0">
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100 transition-all">
                  <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search FAQs, terms, features…"
                    className="flex-1 text-[13px] text-slate-700 placeholder-slate-400 bg-transparent focus:outline-none"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {search ? (
                /* Search results */
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  {!searchResults?.length ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                        <Search className="w-5 h-5 text-slate-300" />
                      </div>
                      <p className="text-[13px] text-slate-400">No results for "<span className="font-medium">{search}</span>"</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-[11px] text-slate-400 font-medium">{searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found</p>
                      {searchResults.map(({ cat, item }) => {
                        const CatIcon = cat.icon;
                        return (
                          <div key={item.id}>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <CatIcon className={cn("w-3 h-3", cat.color)} />
                              <span className={cn("text-[10px] font-bold uppercase tracking-wide", cat.color)}>{cat.label}</span>
                            </div>
                            <HelpItemCard item={item} />
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              ) : (
                <>
                  {/* Category tabs */}
                  <div className="flex items-center gap-1 px-3 py-2 bg-white border-b border-slate-100 flex-shrink-0 overflow-x-auto scrollbar-none">
                    {CATEGORIES.map(cat => {
                      const Icon  = cat.icon;
                      const active = cat.id === activeCategory;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setActiveCat(cat.id)}
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all flex-shrink-0",
                            active
                              ? cn("text-white shadow-sm", CAT_ACTIVE_BG[cat.id] ?? "bg-blue-600")
                              : "text-slate-500 hover:text-slate-700 hover:bg-slate-50",
                          )}
                        >
                          <Icon className="w-3 h-3" />
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Category header */}
                  <div className={cn("flex items-center gap-3 px-5 py-2.5 flex-shrink-0", currentCat.bg)}>
                    <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0", CAT_ACTIVE_BG[currentCat.id] ?? "bg-blue-600")}>
                      {(() => { const Icon = currentCat.icon; return <Icon className="w-4 h-4 text-white" />; })()}
                    </div>
                    <div>
                      <p className={cn("text-[13px] font-bold", currentCat.color)}>{currentCat.label}</p>
                      <p className="text-[11px] text-slate-500">{currentCat.items.length} article{currentCat.items.length !== 1 ? "s" : ""}</p>
                    </div>
                  </div>

                  {/* FAQ items */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                    {currentCat.items.map(item => <HelpItemCard key={item.id} item={item} />)}

                    {/* Raise ticket CTA (pharmacy users only) */}
                    {!isAgent && (
                      <div className="pt-3 pb-1">
                        <div className="bg-indigo-50 rounded-2xl border border-indigo-100 p-4">
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
                              <TicketCheck className="w-4.5 h-4.5 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-bold text-indigo-900">Still need help?</p>
                              <p className="text-[11px] text-indigo-500 mt-0.5">Our support team responds fast — raise a ticket and we'll take it from here.</p>
                            </div>
                          </div>
                          <button
                            onClick={openTicket}
                            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-bold rounded-xl transition-colors shadow-sm shadow-indigo-200"
                          >
                            <TicketCheck className="w-4 h-4" />
                            Raise a Support Ticket
                            <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── New Ticket Modal (opens on top, panel closed) ── */}
      <AnimatePresence>
        {showTicket && (
          <NewTicketModal
            onClose={() => setShowTicket(false)}
            onSaved={(ticketNumber) => {
              setShowTicket(false);
              toast.success(`Ticket ${ticketNumber} raised successfully`);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
