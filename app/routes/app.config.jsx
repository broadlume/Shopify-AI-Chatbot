import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopConfig, upsertShopConfig } from "../db.server.js";

const PROMPT_OPTIONS = [
  { value: "standardAssistant",    label: "Standard Assistant" },
  { value: "enthusiasticAssistant", label: "Enthusiastic Assistant" },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const config = await getShopConfig(session.shop);
  return {
    shopDomain: session.shop,
    config: config ?? {
      bubbleColor: "#5046E4",
      welcomeMsg:  "👋 Hi there! How can I help you today?",
      promptType:  "standardAssistant",
    },
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const bubbleColor = String(form.get("bubbleColor") || "#5046E4").trim();
  const welcomeMsg  = String(form.get("welcomeMsg")  || "").trim();
  const promptType  = String(form.get("promptType")  || "standardAssistant").trim();

  if (!welcomeMsg) return { ok: false, message: "Welcome message cannot be empty." };

  await upsertShopConfig(session.shop, { bubbleColor, welcomeMsg, promptType });
  return { ok: true, message: "Settings saved." };
};

export default function ConfigPage() {
  const { config, shopDomain } = useLoaderData();
  const actionData  = useActionData();
  const navigation  = useNavigation();
  const isSaving    = navigation.state === "submitting";

  return (
    <s-page>
      <ui-title-bar title="Chatbot Settings" />

      <s-section>
        <s-stack gap="base">
          <s-heading>Chatbot Settings</s-heading>
          <s-paragraph>
            Configure the appearance and behaviour of the AI chat assistant for your store.
            These settings override any values set in the Theme Editor for this store ({shopDomain}).
          </s-paragraph>
          {actionData?.message && (
            <s-banner tone={actionData.ok ? "success" : "critical"}>
              {actionData.message}
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Appearance">
        <Form method="post">
          <div style={{ display: "grid", gap: 18, maxWidth: 560 }}>

            {/* Bubble colour */}
            <div>
              <div style={lbl}>Chat Bubble Color</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="color"
                  name="bubbleColor"
                  defaultValue={config.bubbleColor}
                  style={{ width: 44, height: 36, border: "1px solid #d1d5db", borderRadius: 8, padding: 2, cursor: "pointer" }}
                />
                <input
                  type="text"
                  name="_bubbleColorText"
                  defaultValue={config.bubbleColor}
                  readOnly
                  style={{ ...inp, width: 110, fontFamily: "monospace" }}
                />
              </div>
              <div style={hint}>Used as the accent colour throughout the chat widget.</div>
            </div>

            {/* Welcome message */}
            <div>
              <div style={lbl}>Welcome Message</div>
              <input
                type="text"
                name="welcomeMsg"
                defaultValue={config.welcomeMsg}
                style={inp}
              />
              <div style={hint}>Shown on the welcome screen before the customer starts chatting.</div>
            </div>

            {/* System prompt */}
            <div>
              <div style={lbl}>System Prompt</div>
              <select name="promptType" defaultValue={config.promptType} style={{ ...inp, cursor: "pointer" }}>
                {PROMPT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div style={hint}>Controls the AI's personality and response style.</div>
            </div>

            <button type="submit" disabled={isSaving} style={isSaving ? { ...btn, background: "#9ca3af", cursor: "not-allowed" } : btn}>
              {isSaving ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Theme Extension">
        <s-stack gap="base">
          <s-paragraph>
            The <strong>App Backend URL</strong> must still be set in the Theme Editor under
            <em> App Embeds → AI Chat Assistant</em>. All other settings above override the
            theme extension values automatically.{" "}
            <a
              href={`https://${shopDomain}/admin/themes/current/editor?context=apps`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Theme Editor → App Embeds
            </a>
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

const lbl  = { fontWeight: 600, fontSize: 13, marginBottom: 5, color: "#374151" };
const hint = { fontSize: 12, color: "#6b7280", marginTop: 4 };
const inp  = { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 12px", fontSize: 14, boxSizing: "border-box" };
const btn  = { border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, background: "#0f766e", color: "white", cursor: "pointer" };
