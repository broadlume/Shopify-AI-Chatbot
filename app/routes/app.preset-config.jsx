import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getShopConfig, upsertShopConfig } from "../db.server.js";
import { DEFAULT_PRESET } from "../services/preset-defaults.server.js";

const MAX_ITEMS = 15;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const config = await getShopConfig(session.shop);
  let preset = { ...DEFAULT_PRESET };
  if (config?.presetConfig) {
    try { preset = { ...DEFAULT_PRESET, ...JSON.parse(config.presetConfig) }; } catch {}
  }
  return { shopDomain: session.shop, preset };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const fcCount = Math.min(MAX_ITEMS, parseInt(form.get("fc_count") || "0", 10));
  const scCount = Math.min(MAX_ITEMS, parseInt(form.get("sc_count") || "0", 10));
  const qcCount = Math.min(MAX_ITEMS, parseInt(form.get("qc_count") || "0", 10));

  const preset = {
    heading: form.get("heading")?.trim() || DEFAULT_PRESET.heading,
    subtext:  form.get("subtext")?.trim()  || DEFAULT_PRESET.subtext,
    featureCards: Array.from({ length: fcCount }, (_, i) => ({
      icon:  form.get(`fc_icon_${i}`)?.trim()  || "",
      title: form.get(`fc_title_${i}`)?.trim() || "",
      desc:  form.get(`fc_desc_${i}`)?.trim()  || "",
      chip:  form.get(`fc_chip_${i}`)?.trim()  || "",
    })),
    suggestionChips: Array.from({ length: scCount }, (_, i) => ({
      text: form.get(`sc_text_${i}`)?.trim() || "",
      chip: form.get(`sc_chip_${i}`)?.trim() || "",
    })),
    quickBarChips: Array.from({ length: qcCount }, (_, i) => ({
      icon: form.get(`qc_icon_${i}`)?.trim() || "",
      text: form.get(`qc_text_${i}`)?.trim() || "",
      chip: form.get(`qc_chip_${i}`)?.trim() || "",
    })),
  };

  await upsertShopConfig(session.shop, { presetConfig: JSON.stringify(preset) });
  return { ok: true, message: "Preset configuration saved successfully." };
};

let _uid = 0;
const uid = () => ++_uid;
const withId = (arr) => arr.map((item) => ({ ...item, _id: uid() }));

export default function PresetConfigPage() {
  const { preset } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [featureCards,    setFeatureCards]    = useState(() => withId(preset.featureCards));
  const [suggestionChips, setSuggestionChips] = useState(() => withId(preset.suggestionChips));
  const [quickBarChips,   setQuickBarChips]   = useState(() => withId(preset.quickBarChips));

  const addFC  = () => featureCards.length    < MAX_ITEMS && setFeatureCards(p    => [...p,    { icon: "✨", title: "", desc: "", chip: "", _id: uid() }]);
  const addSC  = () => suggestionChips.length < MAX_ITEMS && setSuggestionChips(p => [...p,    { text: "", chip: "", _id: uid() }]);
  const addQC  = () => quickBarChips.length   < MAX_ITEMS && setQuickBarChips(p   => [...p,    { icon: "⚡", text: "", chip: "", _id: uid() }]);
  const removeFC = (id) => setFeatureCards(p    => p.filter(x => x._id !== id));
  const removeSC = (id) => setSuggestionChips(p => p.filter(x => x._id !== id));
  const removeQC = (id) => setQuickBarChips(p   => p.filter(x => x._id !== id));

  return (
    <s-page>
      <ui-title-bar title="Preset Configuration" />

      {/* ── Page header ─────────────────────────────────────── */}
      <s-section>
        <div style={S.pageHeader}>
          <div style={S.pageTitleRow}>
            <div>
              <h2 style={S.pageTitle}>Preset Configuration</h2>
              <p style={S.pageSubtitle}>
                Customise every element of the chatbot's welcome screen — the heading, subtext,
                feature cards, suggestion chips, and the quick-action bar. Changes apply to all
                visitors of this store.
              </p>
            </div>
          </div>
          {actionData?.message && (
            <div style={actionData.ok ? S.bannerOk : S.bannerErr}>
              {actionData.message}
            </div>
          )}
        </div>
      </s-section>

      <Form id="preset-form" method="post">
        {/* Hidden counts so the server knows how many items to read */}
        <input type="hidden" name="fc_count" value={featureCards.length}    onChange={() => {}} />
        <input type="hidden" name="sc_count" value={suggestionChips.length} onChange={() => {}} />
        <input type="hidden" name="qc_count" value={quickBarChips.length}   onChange={() => {}} />

        {/* ── Welcome Screen ──────────────────────────────────── */}
        <s-section>
          <SectionHeader title="Welcome Screen"
            desc="The first thing visitors see when they open the chat widget." />
          <div style={S.grid2}>
            <Field label="Heading" name="heading" defaultValue={preset.heading}
              hint="Large title at the top of the welcome screen." />
            <Field label="Subtext" name="subtext" defaultValue={preset.subtext}
              hint="Smaller descriptive line shown below the heading." />
          </div>
        </s-section>
        <div style={S.spacer} />

        {/* ── Feature Cards ───────────────────────────────────── */}
        <s-section>
          <SectionHeader title="Feature Cards"
            desc="Grid of clickable cards shown below the heading. Each one sends a preset message to the AI." />
          <div style={S.itemList}>
            {featureCards.map((card, i) => (
              <div key={card._id} style={S.itemCard}>
                <div style={S.itemCardTop}>
                  <span style={S.badge}>Card {i + 1}</span>
                  <button type="button" style={S.removeBtn} onClick={() => removeFC(card._id)}
                    title="Remove this card">✕ Remove</button>
                </div>
                <div style={S.grid4}>
                  <Field label="Icon / Emoji" name={`fc_icon_${i}`}  defaultValue={card.icon}  hint="e.g. 🔍" />
                  <Field label="Title"        name={`fc_title_${i}`} defaultValue={card.title} />
                  <Field label="Description"  name={`fc_desc_${i}`}  defaultValue={card.desc}  />
                  <Field label="Prompt (sent on click)" name={`fc_chip_${i}`} defaultValue={card.chip}
                    hint="Message sent to the AI when tapped." />
                </div>
              </div>
            ))}
          </div>
          <AddRow onClick={addFC} label="Add Feature Card"
            count={featureCards.length} max={MAX_ITEMS} />
        </s-section>
        <div style={S.spacer} />

        {/* ── Suggestion Chips ────────────────────────────────── */}
        <s-section>
          <SectionHeader title="Suggestion Chips"
            desc="Row of pill-shaped buttons shown under the feature cards." />
          <div style={S.itemList}>
            {suggestionChips.map((c, i) => (
              <div key={c._id} style={S.chipCard}>
                <div style={S.itemCardTop}>
                  <span style={S.badge}>Chip {i + 1}</span>
                  <button type="button" style={S.removeBtn} onClick={() => removeSC(c._id)}
                    title="Remove this chip">✕ Remove</button>
                </div>
                <div style={S.grid2}>
                  <Field label="Label"               name={`sc_text_${i}`} defaultValue={c.text} />
                  <Field label="Prompt (sent on click)" name={`sc_chip_${i}`} defaultValue={c.chip} />
                </div>
              </div>
            ))}
          </div>
          <AddRow onClick={addSC} label="Add Suggestion Chip"
            count={suggestionChips.length} max={MAX_ITEMS} />
        </s-section>
        <div style={S.spacer} />

        {/* ── Quick Action Bar ─────────────────────────────────── */}
        <s-section>
          <SectionHeader title="Quick Action Bar"
            desc="Row of icon + label chips pinned at the bottom of the chat window." />
          <div style={S.itemList}>
            {quickBarChips.map((c, i) => (
              <div key={c._id} style={S.chipCard}>
                <div style={S.itemCardTop}>
                  <span style={S.badge}>Chip {i + 1}</span>
                  <button type="button" style={S.removeBtn} onClick={() => removeQC(c._id)}
                    title="Remove this chip">✕ Remove</button>
                </div>
                <div style={S.grid3}>
                  <Field label="Icon"   name={`qc_icon_${i}`} defaultValue={c.icon} hint="Emoji" />
                  <Field label="Label"  name={`qc_text_${i}`} defaultValue={c.text} />
                  <Field label="Prompt" name={`qc_chip_${i}`} defaultValue={c.chip} />
                </div>
              </div>
            ))}
          </div>
          <AddRow onClick={addQC} label="Add Quick Action"
            count={quickBarChips.length} max={MAX_ITEMS} />
        </s-section>
        {/* bottom padding so sticky bar doesn't overlap last section */}
        <div style={{ height: 80 }} />
      </Form>

      {/* ── Sticky save bar ─────────────────────────────────── */}
      <div style={S.stickyBar}>
        <div style={S.saveRow}>
          <button type="submit" form="preset-form" disabled={isSaving}
            style={isSaving ? { ...S.saveBtn, ...S.saveBtnDisabled } : S.saveBtn}>
            {isSaving ? "Saving…" : "Save Configuration"}
          </button>
          <span style={S.saveHint}>Changes apply immediately to all store visitors.</span>
        </div>
      </div>
    </s-page>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

function SectionHeader({ title, desc }) {
  return (
    <div style={S.sectionHeader}>
      <h3 style={S.sectionTitle}>{title}</h3>
      <p  style={S.sectionDesc}>{desc}</p>
    </div>
  );
}

function Field({ label, name, defaultValue, hint }) {
  return (
    <div style={S.field}>
      <label style={S.fieldLabel}>{label}</label>
      <input name={name} defaultValue={defaultValue} style={S.fieldInput} />
      {hint && <p style={S.fieldHint}>{hint}</p>}
    </div>
  );
}

function AddRow({ onClick, label, count, max }) {
  const atMax = count >= max;
  return (
    <div style={S.addRow}>
      <button type="button" onClick={onClick} disabled={atMax}
        style={atMax ? { ...S.addBtn, ...S.addBtnDisabled } : S.addBtn}>
        + {label}
      </button>
      <span style={S.counter}>
        <span style={{ fontWeight: 600, color: atMax ? "#ef4444" : "#374151" }}>{count}</span>
        <span style={{ color: "#9ca3af" }}> / {max}</span>
        {atMax && <span style={S.maxTag}> max reached</span>}
      </span>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const S = {
  /* Page header */
  pageHeader:   { display: "flex", flexDirection: "column", gap: 14 },
  pageTitleRow: { display: "flex", alignItems: "flex-start", gap: 14 },
  pageTitle:    { fontSize: 20, fontWeight: 700, color: "#111827", margin: 0, lineHeight: 1.2 },
  pageSubtitle:  { fontSize: 14, color: "#6b7280", margin: "5px 0 0", lineHeight: 1.55 },
  bannerOk:  { display: "flex", alignItems: "center", gap: 8, background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#065f46", fontWeight: 500 },
  bannerErr: { display: "flex", alignItems: "center", gap: 8, background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#991b1b", fontWeight: 500 },

  /* Section headers */
  sectionHeader: { marginBottom: 20, paddingBottom: 14, borderBottom: "1px solid #f3f4f6" },
  sectionTitle:  { fontSize: 15, fontWeight: 700, color: "#111827", margin: 0 },
  sectionDesc:   { fontSize: 13, color: "#6b7280", margin: "4px 0 0", lineHeight: 1.5 },

  /* Spacer between sections */
  spacer: { height: 28 },

  /* Item containers */
  itemList: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 },
  itemCard: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  chipCard: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,  padding: "12px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  itemCardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  badge:       { fontSize: 11, fontWeight: 700, color: "#4b5563", background: "#f3f4f6", borderRadius: 20, padding: "3px 10px", textTransform: "uppercase", letterSpacing: ".4px" },
  removeBtn:   { background: "none", border: "1px solid #fca5a5", borderRadius: 6, color: "#ef4444", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "3px 10px", lineHeight: 1.5 },

  /* Grids */
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  grid3: { display: "grid", gridTemplateColumns: "90px 1fr 1fr", gap: 12 },
  grid4: { display: "grid", gridTemplateColumns: "90px 1fr 1fr 1fr", gap: 12 },

  /* Field */
  field:      { display: "flex", flexDirection: "column" },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 },
  fieldInput: { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box", color: "#111827", background: "#fff", outline: "none" },
  fieldHint:  { fontSize: 11, color: "#9ca3af", margin: "4px 0 0" },

  /* Add row */
  addRow:         { display: "flex", alignItems: "center", gap: 14, marginTop: 2 },
  addBtn:         { background: "#0f766e", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  addBtnDisabled: { background: "#e5e7eb", color: "#9ca3af", cursor: "not-allowed" },
  counter:        { fontSize: 13 },
  maxTag:         { color: "#ef4444", fontWeight: 600 },

  /* Sticky save bar */
  stickyBar:       { position: "sticky", bottom: 0, zIndex: 100, background: "#fff", borderTop: "1px solid #e5e7eb", boxShadow: "0 -2px 12px rgba(0,0,0,0.06)", padding: "14px 20px" },
  saveRow:         { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" },
  saveBtn:         { background: "#0f766e", color: "#fff", border: "none", borderRadius: 8, padding: "11px 26px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  saveBtnDisabled: { background: "#9ca3af", cursor: "not-allowed" },
  saveHint:        { fontSize: 12, color: "#9ca3af", margin: 0 },
};
