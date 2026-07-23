import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getSyncStatus, listSyncLogs } from "../db.server.js";
import { getStoreKnowledge, syncStoreKnowledge } from "../services/store-sync.server.js";
import { useEffect, useRef, useState } from "react";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const [syncStatus, knowledge, syncLogs] = await Promise.all([
    getSyncStatus(shopDomain),
    getStoreKnowledge(shopDomain),
    listSyncLogs(shopDomain, { limit: 20 }),
  ]);
  return { shopDomain, syncStatus, knowledge, syncLogs };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  // Lightweight poll — return current status without starting a new sync
  if (form.get("intent") === "poll") {
    const [syncStatus, syncLogs] = await Promise.all([
      getSyncStatus(session.shop),
      listSyncLogs(session.shop, { limit: 20 }),
    ]);
    return { poll: true, syncStatus, syncLogs };
  }

  syncStoreKnowledge(session.shop, "manual").catch(err =>
    console.error("[sync] Manual trigger failed:", err?.message ?? err)
  );
  return { started: true };
};

const STEPS = ["Starting…","Fetching shop info…","Fetching collections…","Fetching product types…","Fetching pages…","Fetching blogs & articles…","Sync complete"];
function stepProgress(p) {
  const i = STEPS.findIndex(s => s === p);
  return i < 0 ? 10 : Math.round(((i + 1) / STEPS.length) * 100);
}
function duration(log) {
  if (!log.completedAt) return "…";
  const ms = new Date(log.completedAt) - new Date(log.startedAt);
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
/**
 * Formats a number of cents into a currency string using a Shopify format
 * string.
 *
 * https://help.shopify.com/en/manual/international/pricing/currency-formatting#currency-formatting-options
 *
 * Originally from: https://gist.github.com/stewartknapman/8d8733ea58d2314c373e94114472d44c
 *
 * @param {number} cents - The number of cents to format.
 * @param {string} formatString - The format string to use.
 * @returns {string} The formatted currency string.
 */
function shopifyFormatCurrency(cents, formatString) {
  const placeholderRegex = /{{\s*(\w+)\s*}}/;

  /**
   * Formats a number of cents into a currency string using the provided
   * precision, thousands separator, and decimal separator.
   * @param {number} number - The number of cents to format.
   * @param {number} precision - The number of decimal places to include.
   * @param {string} thousands - The character to use as the thousands separator.
   * @param {string} decimal - The character to use as the decimal separator.
   * @returns {string} The formatted currency string.
   */
  function formatWithDelimiters(number, precision = 2, thousands = ",", decimal = ".") {
    if (isNaN(number) || number == null) {
      return "0";
    }

    const numString = (number / 100.0).toFixed(precision);
    const parts = numString.split(".");
    const dollars = parts[0].replace(
      /(\d)(?=(\d\d\d)+(?!\d))/g,
      "$1" + thousands,
    );
    const centsPart = parts[1] ? decimal + parts[1] : "";
    return dollars + centsPart;
  }

  return formatString.replace(placeholderRegex, (match, placeholder) => {
    switch (placeholder) {
      case "amount":
        // Ex. 1,134.65
        return formatWithDelimiters(cents, 2);
      case "amount_no_decimals":
        // Ex. 1,135
        return formatWithDelimiters(cents, 0);
      case "amount_with_comma_separator":
        // Ex. 1.134,65
        return formatWithDelimiters(cents, 2, ".", ",");
      case "amount_no_decimals_with_comma_separator":
        // Ex. 1.135
        return formatWithDelimiters(cents, 0, ".", ",");
      case "amount_with_apostrophe_separator":
        // Ex. 1'134.65
        return formatWithDelimiters(cents, 2, "'", ".");
      case "amount_no_decimals_with_space_separator":
        // Ex. 1 135
        return formatWithDelimiters(cents, 0, " ");
      case "amount_with_space_separator":
        // 1 134,65
        return formatWithDelimiters(cents, 2, " ", ",");
      case "amount_with_period_and_space_separator":
        // 1 134.65
        return formatWithDelimiters(cents, 2, " ", ".");
      default:
        return match;
    }
  });
}
/** Format a price value using the store's currency code. */
function fmtPrice(cents, currency) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return `${currency ?? "USD"} 0`;

  // Most stores use this format; include currency code suffix for non-USD.
  const base = shopifyFormatCurrency(Math.round(n), "${{amount}}");
  if (!currency || currency === "USD") return base;

  try {
    // Keep symbol-accurate output when we only have currency code (no shop.money_format).
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n / 100);
  } catch {
    return `${base} ${currency}`;
  }
}
/** Format a price range — shows single value when min === max. */
function fmtRange(r) {
  // Support both new ({min,max,currency}) and old ({priceRange}) formats
  if (r.min !== undefined && r.max !== undefined) {
    return r.min === r.max
      ? fmtPrice(r.min, r.currency)
      : `${fmtPrice(r.min, r.currency)}–${fmtPrice(r.max, r.currency)}`;
  }
  return r.priceRange ?? "";
}
/** Format a UTC date string in the store's IANA timezone. */
function fmtStoreTime(dateStr, timezone) {
  if (!dateStr) return "Never";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || undefined,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).format(new Date(dateStr)).replace(",", "");
  } catch {
    return new Date(dateStr).toLocaleString();
  }
}

export default function SettingsPage() {
  const initial = useLoaderData();
  const triggerFetcher = useFetcher();
  // localRunning: true while we're waiting for the background sync to finish.
  // Driven by delayed re-polls via triggerFetcher so no extra auth requests.
  const [localRunning, setLocalRunning] = useState(false);
  const pollTimers = useRef([]);

  const syncStatus = triggerFetcher.data?.poll
    ? triggerFetcher.data.syncStatus
    : initial.syncStatus;
  const syncLogs = triggerFetcher.data?.poll
    ? triggerFetcher.data.syncLogs
    : initial.syncLogs;
  const knowledge = initial.knowledge;

  const isRunning = localRunning || syncStatus?.status === "running";
  const progress  = stepProgress(syncStatus?.progress);
  const lastSync  = fmtStoreTime(syncStatus?.lastSyncAt, knowledge?.summary?.timezone);
  const statusLabel = {running:"⏳ Running",completed:"✅ Completed",failed:"❌ Failed"}[syncStatus?.status] ?? "— Idle";

  // On trigger: mark running and fire the first poll after 3 s.
  useEffect(() => {
    if (!triggerFetcher.data?.started) return;
    setLocalRunning(true);
    pollTimers.current.forEach(clearTimeout);
    pollTimers.current = [];
    const t = setTimeout(() => {
      triggerFetcher.submit({ intent: "poll" }, { method: "post" });
    }, 3000);
    pollTimers.current.push(t);
    // No cleanup return here — timers are managed explicitly so that a poll
    // response changing triggerFetcher.data does NOT cancel pending timers.
  }, [triggerFetcher.data?.started]);

  // After each poll: keep polling every 4 s while still running; stop when done.
  useEffect(() => {
    if (!triggerFetcher.data?.poll) return;
    if (syncStatus?.status === "running") {
      // Sync still in progress — check again shortly.
      const t = setTimeout(() => {
        triggerFetcher.submit({ intent: "poll" }, { method: "post" });
      }, 4000);
      pollTimers.current.push(t);
    } else {
      // Completed or failed — clear everything and update UI.
      setLocalRunning(false);
      pollTimers.current.forEach(clearTimeout);
      pollTimers.current = [];
    }
  }, [triggerFetcher.data]);

  // Clear timers on unmount only.
  useEffect(() => () => { pollTimers.current.forEach(clearTimeout); }, []);

  return (
    <s-page>
      <ui-title-bar title="Store Knowledge Sync" />

      <s-section heading="Store Knowledge Sync">
        <div style={{display:"grid",gap:14}}>
          <s-paragraph>
            The AI tailors its responses to your store by analyzing a snapshot of your active catalog, collections, pages, and blog posts. Your store's data syncs automatically every 30 minutes, though you can also trigger a manual sync whenever needed.
          </s-paragraph>
          <s-separator />

          <div style={grid2}><span style={{fontWeight:600}}>Status</span><span style={{fontWeight:700}}>{statusLabel}</span></div>
          <div style={grid2}><span style={{fontWeight:600}}>Last synced</span><span>{lastSync}</span></div>
          {syncStatus?.progress && (
            <div style={grid2}><span style={{fontWeight:600}}>Step</span><span style={{color:"#6b7280"}}>{syncStatus.progress}</span></div>
          )}

          {isRunning && (
            <div>
              <div style={{height:10,borderRadius:5,background:"#e5e7eb",overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:5,background:"#0f766e",transition:"width .4s ease",width:`${progress}%`}} />
              </div>
              <div style={{fontSize:12,color:"#6b7280",marginTop:4}}>{progress}% complete</div>
            </div>
          )}

          {syncStatus?.status === "failed" && (
            <div style={{padding:"10px 14px",borderRadius:8,background:"#fee2e2",color:"#991b1b",fontSize:14}}>
              <strong>Sync failed:</strong> {syncStatus.error}
            </div>
          )}

          {knowledge && Object.keys(knowledge).length > 0 && !isRunning && (
            <div style={{background:"#f0fdf4",borderRadius:10,padding:"16px 18px",border:"1px solid #bbf7d0"}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:"#166534",letterSpacing:".3px",textTransform:"uppercase"}}>Current snapshot</div>
              <div style={{display:"grid",gap:12}}>

                {knowledge.summary && (
                  <SnapshotRow label="Store">
                    <Tag color="#166534" bg="#dcfce7">{knowledge.summary.name}</Tag>
                    {knowledge.summary.totalProducts != null && <Tag color="#166534" bg="#dcfce7">{knowledge.summary.totalProducts.toLocaleString()} products</Tag>}
                    {knowledge.summary.totalCollections != null && <Tag color="#166534" bg="#dcfce7">{knowledge.summary.totalCollections} collections</Tag>}
                  </SnapshotRow>
                )}

                {knowledge.productTypes?.length > 0 && (
                  <SnapshotRow label="Product types">
                    {knowledge.productTypes.map(t => <Tag key={t} color="#1e40af" bg="#dbeafe">{t}</Tag>)}
                  </SnapshotRow>
                )}

                {knowledge.collections?.length > 0 && (
                  <SnapshotRow label="Collections">
                    {knowledge.collections.slice(0,10).map(c => (
                      <Tag key={c.handle} color="#5b21b6" bg="#ede9fe">{c.title} <span style={{opacity:.65}}>({c.productCount})</span></Tag>
                    ))}
                    {knowledge.collections.length > 10 && <Tag color="#6b7280" bg="#f3f4f6">+{knowledge.collections.length-10} more</Tag>}
                  </SnapshotRow>
                )}

                {knowledge.priceRanges?.length > 0 && (
                  <SnapshotRow label="Price ranges">
                    {knowledge.priceRanges.slice(0,8).map(r => (
                      <Tag key={r.type} color="#92400e" bg="#fef3c7">
                        <strong>{r.type}</strong>&nbsp;<span style={{opacity:.75}}>{fmtRange(r)}</span>
                      </Tag>
                    ))}
                  </SnapshotRow>
                )}

                {knowledge.topTags?.length > 0 && (
                  <SnapshotRow label="Top tags">
                    {knowledge.topTags.slice(0,20).map(t => <Tag key={t} color="#374151" bg="#f3f4f6">{t}</Tag>)}
                  </SnapshotRow>
                )}

                {knowledge.variantSpecs?.length > 0 && (
                  <SnapshotRow label="Spec fields">
                    {knowledge.variantSpecs.map(s => <Tag key={s.key} color="#065f46" bg="#d1fae5">{s.name ?? s.key}</Tag>)}
                  </SnapshotRow>
                )}

                {knowledge.pages?.length > 0 && (
                  <SnapshotRow label="Pages">
                    {knowledge.pages.map(p => <Tag key={p.handle} color="#374151" bg="#f3f4f6">{p.title}</Tag>)}
                  </SnapshotRow>
                )}

                {knowledge.blogs?.length > 0 && (
                  <SnapshotRow label="Blogs">
                    {knowledge.blogs.map(b => (
                      <Tag key={b.handle} color="#374151" bg="#f3f4f6">{b.title} <span style={{opacity:.6}}>({b.articles.length})</span></Tag>
                    ))}
                  </SnapshotRow>
                )}

                {knowledge.faqs?.length > 0 && (
                  <SnapshotRow label="FAQs">
                    <Tag color="#065f46" bg="#d1fae5">{knowledge.faqs.length} published entr{knowledge.faqs.length === 1 ? "y" : "ies"}</Tag>
                  </SnapshotRow>
                )}
              </div>
            </div>
          )}

          <triggerFetcher.Form method="post" style={{display:"flex",gap:10,alignItems:"center"}}>
            <button type="submit" disabled={isRunning}
              style={isRunning ? {...btn,background:"#9ca3af",cursor:"not-allowed"} : btn}>
              {isRunning ? "Syncing…" : "Sync Now"}
            </button>
            {isRunning && <span style={{fontSize:13,color:"#6b7280"}}>This may take a few seconds…</span>}
          </triggerFetcher.Form>
        </div>
      </s-section>

      <s-section heading="Sync Log">
        {syncLogs.length === 0 ? (
          <s-paragraph>No syncs recorded yet. Click "Sync Now" to start.</s-paragraph>
        ) : (
          <div style={{display:"grid",gap:8}}>
            <div style={logHeader}>
              <span>Started</span><span>Trigger</span><span>Status</span><span>Duration</span><span>Message</span>
            </div>
            {syncLogs.map(log => {
              const isOk = log.status === "completed";
              const msgColor = isOk ? "#16a34a" : log.error ? "#dc2626" : "#6b7280";
              const msg = log.error
                ? log.error
                : isOk ? "Completed successfully"
                : log.status === "running" ? "In progress…"
                : "—";
              return (
                <div key={log.id} style={logRow}>
                  <span style={{fontSize:12,color:"#6b7280"}}>{fmtStoreTime(log.startedAt, knowledge?.summary?.timezone)}</span>
                  <span><span style={{...badge,background:log.trigger==="manual"?"#2563eb":"#7c3aed"}}>{log.trigger}</span></span>
                  <span><span style={{...badge,background:{completed:"#16a34a",failed:"#dc2626",running:"#d97706"}[log.status]??"#6b7280"}}>{log.status}</span></span>
                  <span style={{fontSize:12}}>{duration(log)}</span>
                  <span style={{fontSize:12,color:msgColor,fontWeight:log.error?600:400}}>{msg}</span>
                </div>
              );
            })}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const grid2={display:"grid",gridTemplateColumns:"160px 1fr",gap:8,fontSize:14,borderBottom:"1px solid #f3f4f6",paddingBottom:8};
const btn={border:"none",borderRadius:8,padding:"10px 18px",fontSize:14,fontWeight:600,background:"#0f766e",color:"white",cursor:"pointer"};
const logHeader={display:"grid",gridTemplateColumns:"180px 80px 90px 70px 1fr",gap:10,padding:"6px 10px",fontWeight:600,fontSize:12,color:"#374151",borderBottom:"2px solid #e5e7eb"};
const logRow={display:"grid",gridTemplateColumns:"180px 80px 90px 70px 1fr",gap:10,alignItems:"center",padding:"8px 10px",background:"#f9fafb",borderRadius:6,border:"1px solid #e5e7eb",fontSize:13};
const badge={display:"inline-block",padding:"2px 8px",borderRadius:99,fontSize:11,fontWeight:600,color:"white"};

function Tag({ color, bg, children }) {
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:2,padding:"3px 10px",borderRadius:99,fontSize:12,fontWeight:500,color,background:bg,whiteSpace:"nowrap"}}>
      {children}
    </span>
  );
}

function SnapshotRow({ label, children }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"120px 1fr",gap:10,alignItems:"start"}}>
      <span style={{fontSize:12,fontWeight:600,color:"#374151",paddingTop:4}}>{label}</span>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{children}</div>
    </div>
  );
}
