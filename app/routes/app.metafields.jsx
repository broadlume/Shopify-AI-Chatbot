import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  deleteMetafieldPermission,
  listMetafieldPermissions,
  updateMetafieldPermission,
  upsertMetafieldPermission,
} from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const permissions = await listMetafieldPermissions(session.shop);

  return {
    shopDomain: session.shop,
    productPermissions: permissions.filter((row) => row.ownerType === "PRODUCT"),
    variantPermissions: permissions.filter((row) => row.ownerType === "VARIANT"),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "add") {
      const ownerType = String(formData.get("ownerType") || "").trim();
      const namespace = String(formData.get("namespace") || "").trim();
      const key = String(formData.get("key") || "").trim();

      if (!["PRODUCT", "VARIANT"].includes(ownerType)) {
        return { ok: false, message: "Invalid owner type." };
      }

      if (!namespace || !key) {
        return { ok: false, message: "Namespace and key are required." };
      }

      await upsertMetafieldPermission({
        shopDomain: session.shop,
        ownerType,
        namespace,
        key,
      });

      return {
        ok: true,
        message:
          ownerType === "PRODUCT"
            ? "Allowed product metafield added."
            : "Allowed variant metafield added.",
      };
    }

    if (intent === "toggle") {
      const id = String(formData.get("id") || "").trim();
      const enabled = String(formData.get("enabled") || "") === "true";

      if (!id) {
        return { ok: false, message: "Permission id is required." };
      }

      await updateMetafieldPermission(id, !enabled);
      return { ok: true, message: !enabled ? "Permission enabled." : "Permission disabled." };
    }

    if (intent === "delete") {
      const id = String(formData.get("id") || "").trim();

      if (!id) {
        return { ok: false, message: "Permission id is required." };
      }

      await deleteMetafieldPermission(id);
      return { ok: true, message: "Permission deleted." };
    }

    return { ok: false, message: "Unsupported action." };
  } catch (error) {
    console.error("Metafield permissions action error:", error);
    return { ok: false, message: "Unable to update metafield permissions." };
  }
};

export default function MetafieldPermissionsPage() {
  const { shopDomain, productPermissions, variantPermissions } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page>
      <ui-title-bar title="Metafield Access" />

      <s-section>
        <s-stack gap="base">
          <s-heading>Allowed metafields for AI product answers</s-heading>
          <s-paragraph>
            Manage product and variant metafield permissions separately. The chatbot can only return metafields listed here.
          </s-paragraph>
          <s-text>Current store: {shopDomain}</s-text>
          {actionData?.message ? (
            <s-banner tone={actionData.ok ? "success" : "critical"}>{actionData.message}</s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Permissible Product Metafields">
        <Form method="post">
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="ownerType" value="PRODUCT" />
          <div style={{ display: "grid", gap: 10, maxWidth: 860 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Namespace</div>
              <input name="namespace" required aria-label="Product metafield namespace" style={inputStyle} />
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Key</div>
              <input name="key" required aria-label="Product metafield key" style={inputStyle} />
            </div>
            <button type="submit" disabled={isSubmitting} style={buttonStyle}>Add product metafield permission</button>
          </div>
        </Form>

        <PermissionList rows={productPermissions} isSubmitting={isSubmitting} emptyText="No product metafield permissions yet." />
      </s-section>

      <s-section heading="Permissible Variant Metafields">
        <Form method="post">
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="ownerType" value="VARIANT" />
          <div style={{ display: "grid", gap: 10, maxWidth: 860 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Namespace</div>
              <input name="namespace" required aria-label="Variant metafield namespace" style={inputStyle} />
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Key</div>
              <input name="key" required aria-label="Variant metafield key" style={inputStyle} />
            </div>
            <button type="submit" disabled={isSubmitting} style={buttonStyle}>Add variant metafield permission</button>
          </div>
        </Form>

        <PermissionList rows={variantPermissions} isSubmitting={isSubmitting} emptyText="No variant metafield permissions yet." />
      </s-section>
    </s-page>
  );
}

function PermissionList({ rows, isSubmitting, emptyText }) {
  if (!rows || rows.length === 0) {
    return <s-paragraph>{emptyText}</s-paragraph>;
  }

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
      {rows.map((row) => (
        <div key={row.id} style={cardStyle}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong>{row.namespace}.{row.key}</strong>
            <small>Status: {row.enabled ? "Enabled" : "Disabled"}</small>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Form method="post">
              <input type="hidden" name="intent" value="toggle" />
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="enabled" value={String(row.enabled)} />
              <button type="submit" disabled={isSubmitting} style={secondaryButtonStyle}>
                {row.enabled ? "Disable" : "Enable"}
              </button>
            </Form>

            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={row.id} />
              <button type="submit" disabled={isSubmitting} style={dangerButtonStyle}>Delete</button>
            </Form>
          </div>
        </div>
      ))}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  border: "1px solid #cfd4dc",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
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

const cardStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 12,
  background: "#fff",
};
