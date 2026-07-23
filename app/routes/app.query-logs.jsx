import { Form, useLoaderData, useNavigate, useFetcher, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { listQueryLogs, deleteQueryLog, createFaqEntry } from "../db.server.js";
import { useState } from "react";

const PAGE_SIZE = 50;
const REASON_LABELS = { no_results:"No results found", ai_uncertain:"AI uncertain", out_of_scope:"Out of scope", tool_error:"Tool error" };

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const { items, total } = await listQueryLogs(session.shop, { limit: PAGE_SIZE, offset: (page-1)*PAGE_SIZE });
  return { items, total, page, totalPages: Math.max(1, Math.ceil(total/PAGE_SIZE)) };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent") ?? "delete";

  if (intent === "convert_to_faq") {
    const question = String(form.get("question") || "").trim();
    const answer   = String(form.get("answer")   || "").trim();
    const tags     = String(form.get("tags")      || "").trim();
    const logId    = form.get("log_id");

    if (!question || !answer)
      return { ok: false, message: "Question and answer are required.", logId };

    await createFaqEntry({
      shopDomain: session.shop,
      question,
      answer,
      tags: tags || null,
      source: "query_log",
      published: true,
    });

    // Optionally delete the log entry once it's been converted
    if (logId) await deleteQueryLog(String(logId)).catch(() => {});

    return { ok: true, message: "FAQ created successfully.", logId };
  }

  // Default: delete
  const id = form.get("id");
  if (id) await deleteQueryLog(String(id));
  return { ok: true };
};

function ConvertForm({ log, onClose }) {
  const fetcher = useFetcher();
  const done = fetcher.data?.ok === true && fetcher.data?.logId === log.id;
  const err  = fetcher.data?.ok === false && fetcher.data?.logId === log.id;
  const busy = fetcher.state !== "idle";

  if (done) {
    return (
      <div style={successBox}>
        ✅ FAQ saved. This log entry has been removed.
      </div>
    );
  }

  return (
    <div style={convertPanel}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:"#1e40af"}}>Convert to FAQ</div>
      {err && <div style={errBox}>{fetcher.data.message}</div>}
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="convert_to_faq" />
        <input type="hidden" name="log_id" value={log.id} />
        <div style={{display:"grid",gap:10}}>
          <div>
            <label style={lbl}>Question <span style={{color:"#dc2626"}}>*</span></label>
            <textarea name="question" rows={2} required defaultValue={log.query} style={inp} />
          </div>
          <div>
            <label style={lbl}>Answer <span style={{color:"#dc2626"}}>*</span></label>
            <textarea name="answer" rows={4} required placeholder="Write the answer the AI should give…" style={inp} />
          </div>
          <div>
            <label style={lbl}>Tags (optional)</label>
            <input name="tags" placeholder="shipping, returns, policy" style={{...inp,resize:undefined}} />
          </div>
          <div style={{display:"flex",gap:8}}>
            <button type="submit" disabled={busy} style={saveBtn}>{busy?"Saving…":"Save as FAQ"}</button>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
          </div>
        </div>
      </fetcher.Form>
    </div>
  );
}

export default function QueryLogsPage() {
  const { items, total, page, totalPages } = useLoaderData();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState(null);

  return (
    <s-page>
      <ui-title-bar title="Query Log" />
      <s-section>
        <s-stack gap="base">
          <s-heading>Unresolved Queries</s-heading>
          <s-paragraph>
            Questions the AI could not confidently answer are logged here. Convert any entry into a FAQ so the AI can answer it correctly in future.
          </s-paragraph>
          <s-text>{total} entr{total === 1 ? "y" : "ies"} recorded.</s-text>
        </s-stack>
      </s-section>

      <s-section>
        {items.length === 0 ? (
          <s-paragraph>No unresolved queries yet — great!</s-paragraph>
        ) : (
          <div style={{display:"grid",gap:10}}>
            <div style={headerRow}>
              <span>Time</span>
              <span>Query</span>
              <span>Reason</span>
              <span>AI excerpt</span>
              <span>Actions</span>
            </div>

            {items.map(log => (
              <div key={log.id}>
                <div style={cardStyle}>
                  <div style={{fontSize:12,color:"#6b7280",whiteSpace:"nowrap"}}>{new Date(log.createdAt).toLocaleString()}</div>
                  <div style={{fontSize:13,wordBreak:"break-word"}}>{log.query.length > 150 ? log.query.slice(0,150)+"…" : log.query}</div>
                  <div><span style={{...badge, background:badgeBg[log.reason]}}>{REASON_LABELS[log.reason] ?? log.reason}</span></div>
                  <div style={{fontSize:12,color:"#6b7280",wordBreak:"break-word"}}>{log.aiResponse || "—"}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    <button
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                      style={expandedId === log.id ? activeConvertBtn : convertBtn}
                    >
                      {expandedId === log.id ? "Cancel" : "→ FAQ"}
                    </button>
                    <Form method="post">
                      <input type="hidden" name="id" value={log.id} />
                      <button type="submit" style={delBtn}>Delete</button>
                    </Form>
                  </div>
                </div>

                {expandedId === log.id && (
                  <ConvertForm
                    log={log}
                    onClose={() => setExpandedId(null)}
                  />
                )}
              </div>
            ))}

            {totalPages > 1 && (
              <div style={{display:"flex",gap:8,marginTop:8,alignItems:"center"}}>
                <button disabled={page<=1} onClick={()=>navigate(`?page=${page-1}`)} style={navBtn}>← Prev</button>
                <span style={{fontSize:13}}>Page {page} of {totalPages}</span>
                <button disabled={page>=totalPages} onClick={()=>navigate(`?page=${page+1}`)} style={navBtn}>Next →</button>
              </div>
            )}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const cardStyle   = {display:"grid",gridTemplateColumns:"160px 1fr 140px 1fr 80px",gap:12,alignItems:"start",padding:"10px 14px",background:"#f9fafb",borderRadius:8,border:"1px solid #e5e7eb",fontSize:13};
const headerRow   = {display:"grid",gridTemplateColumns:"160px 1fr 140px 1fr 80px",gap:12,padding:"6px 14px",fontWeight:600,fontSize:12,color:"#374151"};
const badge       = {display:"inline-block",padding:"2px 8px",borderRadius:99,fontSize:12,fontWeight:600,color:"#fff"};
const badgeBg     = {no_results:"#d97706",ai_uncertain:"#7c3aed",out_of_scope:"#0891b2",tool_error:"#dc2626"};
const delBtn      = {width:"100%",border:"none",borderRadius:6,padding:"4px 10px",fontSize:12,background:"#fee2e2",color:"#991b1b",cursor:"pointer"};
const convertBtn  = {width:"100%",border:"1px solid #2563eb",borderRadius:6,padding:"4px 10px",fontSize:12,background:"#eff6ff",color:"#1d4ed8",cursor:"pointer",fontWeight:600};
const activeConvertBtn = {...convertBtn,background:"#dbeafe"};
const navBtn      = {border:"1px solid #d1d5db",borderRadius:6,padding:"6px 12px",fontSize:13,background:"white",cursor:"pointer"};
const convertPanel= {marginTop:4,padding:"14px 16px",background:"#eff6ff",borderRadius:8,border:"1px solid #bfdbfe"};
const inp         = {width:"100%",border:"1px solid #cbd5e1",borderRadius:8,padding:"8px 10px",fontSize:13,resize:"vertical",boxSizing:"border-box"};
const lbl         = {display:"block",fontWeight:600,fontSize:12,color:"#374151",marginBottom:4};
const saveBtn     = {border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,background:"#1d4ed8",color:"white",cursor:"pointer"};
const cancelBtn   = {border:"1px solid #d1d5db",borderRadius:8,padding:"8px 16px",fontSize:13,background:"white",cursor:"pointer"};
const successBox  = {padding:"10px 14px",borderRadius:8,background:"#dcfce7",color:"#166534",fontSize:13,fontWeight:600};
const errBox      = {padding:"8px 12px",borderRadius:8,background:"#fee2e2",color:"#991b1b",fontSize:13,marginBottom:8};

export function ErrorBoundary() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <s-page>
      <ui-title-bar title="Query Log" />
      <s-section>
        <s-banner tone="critical">
          Failed to load query logs: {message}
        </s-banner>
      </s-section>
    </s-page>
  );
}
