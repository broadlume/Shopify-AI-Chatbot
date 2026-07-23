import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState, useRef } from "react";
import {
  bulkCreateFaqEntries,
  createFaqEntry,
  deleteFaqEntry,
  listFaqEntries,
  updateFaqEntry,
} from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const faqEntries = await listFaqEntries(session.shop);

  return {
    faqEntries,
    shopDomain: session.shop,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "create") {
      const question = String(formData.get("question") || "").trim();
      const answer = String(formData.get("answer") || "").trim();
      const tags = String(formData.get("tags") || "").trim();

      if (!question || !answer) {
        return { ok: false, message: "Question and answer are required." };
      }

      await createFaqEntry({
        shopDomain: session.shop,
        question,
        answer,
        tags: tags || null,
        source: "manual",
        published: true,
      });

      return { ok: true, message: "FAQ added." };
    }

    if (intent === "update") {
      const id       = String(formData.get("id")       || "");
      const question = String(formData.get("question") || "").trim();
      const answer   = String(formData.get("answer")   || "").trim();
      const tags     = String(formData.get("tags")     || "").trim();

      if (!id)               return { ok: false, message: "FAQ id is required." };
      if (!question || !answer) return { ok: false, message: "Question and answer are required." };

      await updateFaqEntry(id, { question, answer, tags: tags || null });
      return { ok: true, message: "FAQ updated.", updatedId: id };
    }

    if (intent === "toggle") {
      const id = String(formData.get("id") || "");
      const published = String(formData.get("published") || "") === "true";

      if (!id) {
        return { ok: false, message: "FAQ id is required." };
      }

      await updateFaqEntry(id, { published: !published });
      return { ok: true, message: !published ? "FAQ published." : "FAQ hidden." };
    }

    if (intent === "delete") {
      const id = String(formData.get("id") || "");

      if (!id) {
        return { ok: false, message: "FAQ id is required." };
      }

      await deleteFaqEntry(id);
      return { ok: true, message: "FAQ deleted." };
    }

    if (intent === "bulk_import") {
      const sourceLabel = String(formData.get("source") || "shopify_kb").trim();
      const entriesJson = String(formData.get("entries_json") || "").trim();

      if (!entriesJson) {
        return { ok: false, message: "Paste FAQ JSON before importing." };
      }

      let parsed;
      try {
        parsed = JSON.parse(entriesJson);
      } catch (error) {
        return {
          ok: false,
          message: "Invalid JSON. Expected an array of {question, answer, tags?} objects.",
        };
      }

      if (!Array.isArray(parsed)) {
        return { ok: false, message: "JSON must be an array." };
      }

      const entries = parsed.map((entry) => ({
        question: entry.question,
        answer: entry.answer,
        tags: entry.tags,
        source: entry.source || sourceLabel || "shopify_kb",
        published: entry.published,
      }));

      const count = await bulkCreateFaqEntries(session.shop, entries);
      return { ok: true, message: `Imported ${count} FAQs.` };
    }

    return { ok: false, message: "Unsupported action." };
  } catch (error) {
    console.error("FAQ action error:", error);
    return { ok: false, message: "Unable to process FAQ request." };
  }
};

export default function FaqManagerPage() {
  const { faqEntries, shopDomain } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // ── Search + filter state ─────────────────────────────────────────────────
  const [searchQuery,  setSearchQuery]  = useState("");
  const [selectedTags, setSelectedTags] = useState([]); // active tag filters
  const [editingId,    setEditingId]    = useState(null);

  // All unique tags across all entries
  const allTags = [...new Set(
    faqEntries.flatMap(f => (f.tags || "").split(",").map(t => t.trim()).filter(Boolean))
  )].sort();

  // Intelligent search: tokenise query, score each entry, filter + rank
  const filteredEntries = (() => {
    const tokens = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const tagFiltered = selectedTags.length
      ? faqEntries.filter(f => {
          const ftags = (f.tags || "").split(",").map(t => t.trim().toLowerCase());
          return selectedTags.some(st => ftags.includes(st.toLowerCase()));
        })
      : faqEntries;

    if (!tokens.length) return tagFiltered;

    return tagFiltered
      .map(f => {
        const q = (f.question || "").toLowerCase();
        const a = (f.answer   || "").toLowerCase();
        const t = (f.tags     || "").toLowerCase();
        let score = 0;
        for (const tok of tokens) {
          if (q === tok || a === tok || t.includes(tok)) score += 10;       // exact word
          else if (q.startsWith(tok))                   score += 6;        // prefix in question
          else if (q.includes(tok))                     score += 4;        // substring question
          else if (t.includes(tok))                     score += 3;        // tag match
          else if (a.includes(tok))                     score += 1;        // substring answer
        }
        return { ...f, _score: score };
      })
      .filter(f => f._score > 0)
      .sort((a, b) => b._score - a._score);
  })();

  // ── CSV import state ──────────────────────────────────────────────────────
  const [csvState, setCsvState] = useState("idle");
  const [csvProgress, setCsvProgress] = useState(0);
  const [csvMessage, setCsvMessage] = useState("");
  const [csvJson, setCsvJson] = useState("");
  const [csvRowCount, setCsvRowCount] = useState(0);
  const csvFormRef = useRef(null);

  const isImporting = isSubmitting && navigation.formData?.get("intent") === "bulk_import" && navigation.formData?.get("_source") === "csv";

  function handleCsvFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvState("reading");
    setCsvProgress(15);
    setCsvMessage("Reading file…");
    setCsvJson("");
    setCsvRowCount(0);

    const reader = new FileReader();
    reader.onload = (evt) => {
      setCsvProgress(40);
      setCsvMessage("Parsing CSV…");
      try {
        const entries = parseCsv(evt.target.result);
        if (!entries.length) throw new Error("No valid rows found in CSV.");
        setCsvProgress(90);
        setCsvMessage(`Found ${entries.length} entr${entries.length === 1 ? "y" : "ies"} — ready to import`);
        setCsvJson(JSON.stringify(entries));
        setCsvRowCount(entries.length);
        setCsvState("ready");
      } catch (err) {
        setCsvState("error");
        setCsvMessage(`CSV error: ${err.message}`);
        setCsvProgress(0);
      }
    };
    reader.onerror = () => { setCsvState("error"); setCsvMessage("Failed to read file."); setCsvProgress(0); };
    reader.readAsText(file);
  }

  const csvBarProgress = isImporting ? 100 : csvProgress;

  return (
    <s-page>
      <ui-title-bar title="Store FAQ knowledge" />

      <s-section>
        <s-stack gap="base">
          <s-heading>FAQ knowledge base for your chatbot</s-heading>
          <s-paragraph>
            Add or import FAQs (including entries copied from Shopify Knowledge Base) so the chatbot can answer policy and support questions with grounded store data.
          </s-paragraph>
          <s-text>Current store: {shopDomain}</s-text>
          {actionData?.message ? (
            <s-banner tone={actionData.ok ? "success" : "critical"}>
              {actionData.message}
            </s-banner>
          ) : null}
        </s-stack>
      </s-section>

      {/* ── Existing FAQs — moved to top ── */}
      <s-section heading="Existing FAQs">
        {/* Search + tag filter toolbar */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <input
            type="search"
            placeholder="Search by question, answer or tag…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 260px", resize: "none", borderRadius: 20,
              padding: "9px 16px", background: "#f8fafc" }}
          />
          {allTags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {allTags.map(tag => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTags(prev =>
                      active ? prev.filter(t => t !== tag) : [...prev, tag]
                    )}
                    style={{
                      ...tagChipBase,
                      background: active ? getTagColor(tag) : "#f1f5f9",
                      color:      active ? "#fff" : "#374151",
                      border:     `1px solid ${active ? getTagColor(tag) : "#d1d5db"}`,
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
              {selectedTags.length > 0 && (
                <button type="button" onClick={() => setSelectedTags([])}
                  style={{ fontSize: 12, color: "#6b7280", background: "none", border: "none",
                    cursor: "pointer", textDecoration: "underline" }}>
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {faqEntries.length === 0 ? (
            <s-paragraph>No FAQs yet. Add your first entry below.</s-paragraph>
          ) : filteredEntries.length === 0 ? (
            <s-paragraph>No FAQs match your search. Try different keywords or clear the filters.</s-paragraph>
          ) : (
            filteredEntries.map((faq) => (
              <div key={faq.id} style={cardStyle}>
                {editingId === faq.id ? (
                  <Form method="post" onSubmit={() => setEditingId(null)}>
                    <input type="hidden" name="intent" value="update" />
                    <input type="hidden" name="id" value={faq.id} />
                    <div style={{ display: "grid", gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Question</div>
                        <input name="question" required defaultValue={faq.question} style={inputStyle} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Answer</div>
                        <textarea name="answer" required rows={4} defaultValue={faq.answer} style={inputStyle} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Tags (optional)</div>
                        <input name="tags" defaultValue={faq.tags ?? ""} placeholder="shipping, returns" style={inputStyle} />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="submit" disabled={isSubmitting} style={buttonStyle}>Save</button>
                        <button type="button" onClick={() => setEditingId(null)} style={secondaryButtonStyle}>Cancel</button>
                      </div>
                    </div>
                  </Form>
                ) : (
                  <>
                    <div style={{ display: "grid", gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>{faq.question}</strong>
                      <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{faq.answer}</p>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>
                          Source: {faq.source}
                        </span>
                        <span style={{ fontSize: 12, color: "#d1d5db" }}>·</span>
                        <span style={{
                          fontSize: 12, fontWeight: 600, padding: "1px 8px",
                          borderRadius: 99,
                          background: faq.published ? "#dcfce7" : "#f3f4f6",
                          color:      faq.published ? "#166534" : "#6b7280",
                        }}>
                          {faq.published ? "Published" : "Hidden"}
                        </span>
                        {faq.tags && faq.tags.split(",").map(t => t.trim()).filter(Boolean).map(tag => (
                          <span key={tag} style={{
                            ...tagChipBase,
                            background: getTagColor(tag),
                            color: "#fff",
                            border: "none",
                          }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button type="button" onClick={() => setEditingId(faq.id)} style={editButtonStyle}>
                        Edit
                      </button>
                      <Form method="post">
                        <input type="hidden" name="intent" value="toggle" />
                        <input type="hidden" name="id" value={faq.id} />
                        <input type="hidden" name="published" value={String(faq.published)} />
                        <button type="submit" disabled={isSubmitting} style={secondaryButtonStyle}>
                          {faq.published ? "Hide" : "Publish"}
                        </button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={faq.id} />
                        <button type="submit" disabled={isSubmitting} style={dangerButtonStyle}>
                          Delete
                        </button>
                      </Form>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
          {filteredEntries.length > 0 && (
            <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "right" }}>
              Showing {filteredEntries.length} of {faqEntries.length} entr{faqEntries.length === 1 ? "y" : "ies"}
            </div>
          )}
        </div>
      </s-section>

      <s-section heading="Add FAQ">
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <div style={{ display: "grid", gap: 12, maxWidth: 860 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Question</div>
              <input name="question" required aria-label="FAQ question" style={inputStyle} />
            </div>

            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Answer</div>
              <textarea name="answer" required rows={4} aria-label="FAQ answer" style={inputStyle} />
            </div>

            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Tags (optional)</div>
              <input name="tags" aria-label="FAQ tags" placeholder="shipping, returns, warranty" style={inputStyle} />
            </div>

            <button type="submit" disabled={isSubmitting} style={buttonStyle}>
              Add FAQ
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Bulk import (Shopify KB export or paste)">
        <Form method="post">
          <input type="hidden" name="intent" value="bulk_import" />
          <div style={{ display: "grid", gap: 12, maxWidth: 860 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Source label</div>
              <input name="source" aria-label="Import source label" defaultValue="shopify_kb" style={inputStyle} />
            </div>

            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                FAQ JSON array
              </div>
              <textarea
                name="entries_json"
                rows={9}
                aria-label="FAQ JSON import"
                placeholder='[{"question":"What are your shipping times?","answer":"Orders ship in 1-2 business days.","tags":"shipping"}]'
                style={{ ...inputStyle, fontFamily: "monospace" }}
              />
            </div>

            <button type="submit" disabled={isSubmitting} style={buttonStyle}>
              Import FAQs
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Bulk import via CSV">
        {/* Format guide */}
        <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"12px 14px",marginBottom:16,fontSize:13}}>
          <div style={{fontWeight:700,marginBottom:6}}>CSV format</div>
          <div style={{marginBottom:6,color:"#475569"}}>Required columns: <code style={code}>question</code>, <code style={code}>answer</code> — Optional: <code style={code}>tags</code></div>
          <pre style={{margin:0,background:"#f1f5f9",borderRadius:6,padding:"8px 12px",fontSize:12,overflowX:"auto",whiteSpace:"pre"}}>
{`question,answer,tags
"What are your shipping times?","Orders ship in 1-2 business days.","shipping"
"Can I return a product?","We accept returns within 30 days of purchase.","returns,refunds"
"Do you offer samples?","Yes, samples are available for most flooring products.","samples"`}
          </pre>
          <div style={{marginTop:8,color:"#64748b",fontSize:12}}>
            • First row must be the header. • Wrap fields containing commas in double-quotes. • To include a literal quote, use <code style={code}>""</code>. • Extra columns are ignored.
          </div>
        </div>

        {/* Upload + progress */}
        <Form method="post" ref={csvFormRef}>
          <input type="hidden" name="intent" value="bulk_import" />
          <input type="hidden" name="_source" value="csv" />
          <input type="hidden" name="source" value="csv_import" />
          <input type="hidden" name="entries_json" value={csvJson} />

          <div style={{display:"grid",gap:12,maxWidth:860}}>
            <div>
              <div style={{fontWeight:600,marginBottom:6}}>Select CSV file</div>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvFile}
                style={{fontSize:14}}
              />
            </div>

            {/* Progress bar — visible once a file is chosen */}
            {csvState !== "idle" && (
              <div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
                  <span style={{color: csvState==="error"?"#dc2626": isImporting?"#0f766e": csvState==="ready"?"#166534":"#6b7280"}}>
                    {isImporting ? `Importing ${csvRowCount} entr${csvRowCount===1?"y":"ies"} to database…` : csvMessage}
                  </span>
                  <span style={{color:"#6b7280",fontVariantNumeric:"tabular-nums"}}>{csvBarProgress}%</span>
                </div>
                <div style={{height:8,borderRadius:4,background:"#e5e7eb",overflow:"hidden"}}>
                  <div style={{
                    height:"100%",borderRadius:4,
                    background: csvState==="error"?"#dc2626":isImporting?"#0f766e":"#16a34a",
                    transition:"width .35s ease",
                    width:`${csvBarProgress}%`,
                  }} />
                </div>
                {actionData?.ok && navigation.formData?.get("_source")==="csv" && (
                  <div style={{marginTop:6,fontSize:13,color:"#16a34a",fontWeight:600}}>✅ {actionData.message}</div>
                )}
                {actionData?.ok===false && navigation.formData?.get("_source")==="csv" && (
                  <div style={{marginTop:6,fontSize:13,color:"#dc2626"}}>{actionData.message}</div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={csvState !== "ready" || isImporting}
              style={csvState === "ready" && !isImporting ? buttonStyle : {...buttonStyle,background:"#9ca3af",cursor:"not-allowed"}}
            >
              {isImporting ? "Importing…" : `Import ${csvRowCount > 0 ? csvRowCount + " " : ""}FAQs from CSV`}
            </button>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}

// ── Tag colour palette — deterministic from tag text ──────────────────────
const TAG_PALETTE = [
  "#1d4ed8","#0f766e","#7c3aed","#b45309","#be185d",
  "#0284c7","#16a34a","#dc2626","#ea580c","#0891b2",
];
function getTagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}

const tagChipBase = {
  display: "inline-block", padding: "2px 10px", borderRadius: 99,
  fontSize: 12, fontWeight: 600, cursor: "pointer",
  transition: "opacity .15s",
};

const inputStyle = {
  width: "100%",
  border: "1px solid #cfd4dc",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
  resize: "vertical",
};

const buttonStyle = {
  width: "fit-content",
  border: "none",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 14,
  fontWeight: 600,
  background: "#0f766e",
  color: "white",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  ...buttonStyle,
  background: "#334155",
};

const dangerButtonStyle = {
  ...buttonStyle,
  background: "#b91c1c",
};

const editButtonStyle = {
  ...buttonStyle,
  background: "#1d4ed8",
};

const cardStyle = {
  display: "grid",
  gap: 10,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 14,
  background: "#ffffff",
};

const code = {
  fontFamily: "monospace",
  background: "#f1f5f9",
  padding: "1px 5px",
  borderRadius: 4,
  fontSize: 12,
};

// ── CSV parsing helpers ──────────────────────────────────────────────────────

/** Parse a single CSV row, respecting double-quoted fields. */
function parseCsvRow(row) {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '"') {
      if (inQuotes && row[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      cols.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  cols.push(cur);
  return cols;
}

/** Parse a CSV string into FAQ entry objects. Throws on format errors. */
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter(l => l.trim());
  if (nonEmpty.length < 2) throw new Error("Need at least a header row and one data row.");

  const headers = parseCsvRow(nonEmpty[0]).map(h => h.toLowerCase().trim());
  const qIdx = headers.indexOf("question");
  const aIdx = headers.indexOf("answer");
  const tIdx = headers.indexOf("tags");

  if (qIdx === -1) throw new Error('Missing required column "question".');
  if (aIdx === -1) throw new Error('Missing required column "answer".');

  const entries = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const cols = parseCsvRow(nonEmpty[i]);
    const q = cols[qIdx]?.trim();
    const a = cols[aIdx]?.trim();
    if (!q || !a) continue; // skip blank rows
    entries.push({
      question: q,
      answer: a,
      tags: tIdx >= 0 ? cols[tIdx]?.trim() || null : null,
    });
  }

  if (!entries.length) throw new Error("No valid rows found (every row was empty or missing question/answer).");
  return entries;
}
