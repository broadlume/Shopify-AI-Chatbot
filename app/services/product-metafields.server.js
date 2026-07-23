import AppConfig from "./config.server";
import {
  getEnabledMetafieldPermissions,
  getOfflineAccessTokenByShop,
} from "../db.server";

/**
 * Creates a local tool that fetches product and variant metafields with namespace restrictions.
 */
export function createProductMetafieldsToolService({ shopDomain }) {
  const localTools = [
    {
      name: "get_product_with_restricted_metafields",
      description:
        "Fetch product details including product and variant metafields, restricted to allowed namespaces only.",
      input_schema: {
        type: "object",
        properties: {
          product_id: {
            type: "string",
            description: "Product GID, e.g. gid://shopify/Product/123",
          },
          handle: {
            type: "string",
            description: "Product handle when product_id is not provided",
          },
          product_namespaces: {
            type: "array",
            items: { type: "string" },
            description: "Requested product metafield namespaces. Must be a subset of allowed product namespaces.",
          },
          variant_namespaces: {
            type: "array",
            items: { type: "string" },
            description: "Requested variant metafield namespaces. Must be a subset of allowed variant namespaces.",
          },
          variant_limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximum variants to include",
          },
        },
      },
    },
  ];

  const canHandle = (toolName) => {
    return localTools.some((tool) => tool.name === toolName);
  };

  const executeTool = async (toolName, toolArgs = {}) => {
    if (toolName !== "get_product_with_restricted_metafields") {
      throw new Error(`Unsupported product metafield tool: ${toolName}`);
    }

    const accessRules = await buildAccessRules(shopDomain);

    const requestedProductNamespaces = normalizeNamespaces(toolArgs.product_namespaces);
    const requestedVariantNamespaces = normalizeNamespaces(toolArgs.variant_namespaces);

    const productNamespaces = requestedProductNamespaces.length > 0
      ? requestedProductNamespaces
      : accessRules.allowedProductNamespaces;
    const variantNamespaces = requestedVariantNamespaces.length > 0
      ? requestedVariantNamespaces
      : accessRules.allowedVariantNamespaces;

    const disallowedProductNamespaces = productNamespaces.filter(
      (namespace) => !accessRules.allowedProductNamespaces.includes(namespace),
    );

    const disallowedVariantNamespaces = variantNamespaces.filter(
      (namespace) => !accessRules.allowedVariantNamespaces.includes(namespace),
    );

    if (disallowedProductNamespaces.length > 0 || disallowedVariantNamespaces.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "namespace_not_allowed",
              allowed_product_namespaces: accessRules.allowedProductNamespaces,
              allowed_variant_namespaces: accessRules.allowedVariantNamespaces,
              rejected_product_namespaces: disallowedProductNamespaces,
              rejected_variant_namespaces: disallowedVariantNamespaces,
            }),
          },
        ],
      };
    }

    const variantLimit = Math.max(
      1,
      Math.min(Number(toolArgs.variant_limit || AppConfig.metafields.defaultVariantLimit), 100),
    );

    const productId = String(toolArgs.product_id || "").trim();
    const handle = String(toolArgs.handle || "").trim();

    if (!productId && !handle) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "missing_identifier",
              message: "Provide product_id or handle",
            }),
          },
        ],
      };
    }

    const accessToken = await getOfflineAccessTokenByShop(shopDomain);
    if (!accessToken) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "missing_shop_token",
              message:
                "No offline admin token found for this shop. Install/re-auth the app in this store first.",
            }),
          },
        ],
      };
    }

    const endpoint = `https://${shopDomain}/admin/api/2025-10/graphql.json`;
    const query = productId ? PRODUCT_BY_ID_QUERY : PRODUCT_BY_HANDLE_QUERY;
    const variables = productId
      ? { productId, variantLimit }
      : { handle, variantLimit };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    const payload = await response.json();

    if (!response.ok || payload.errors) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "admin_graphql_error",
              message: "Failed to query Admin GraphQL",
              details: payload.errors || payload,
            }),
          },
        ],
      };
    }

    const product = productId ? payload?.data?.product : payload?.data?.productByHandle;
    if (!product) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              product: null,
              message: "No product found",
            }),
          },
        ],
      };
    }

    const filtered = formatAndFilterProduct(product, {
      productRules: accessRules.productRules,
      variantRules: accessRules.variantRules,
      productNamespaces,
      variantNamespaces,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            allowed_product_namespaces: accessRules.allowedProductNamespaces,
            allowed_variant_namespaces: accessRules.allowedVariantNamespaces,
            applied_product_namespaces: productNamespaces,
            applied_variant_namespaces: variantNamespaces,
            product: filtered,
          }),
        },
      ],
    };
  };

  return {
    canHandle,
    executeTool,
    getTools: () => localTools,
  };
}

async function buildAccessRules(shopDomain) {
  const enabled = await getEnabledMetafieldPermissions(shopDomain);

  const productRules = enabled.product.length > 0
    ? enabled.product.map((row) => ({ namespace: row.namespace, key: row.key }))
    : AppConfig.metafields.fallbackProductNamespaces.map((namespace) => ({ namespace, key: '*' }));

  const variantRules = enabled.variant.length > 0
    ? enabled.variant.map((row) => ({ namespace: row.namespace, key: row.key }))
    : AppConfig.metafields.fallbackVariantNamespaces.map((namespace) => ({ namespace, key: '*' }));

  return {
    productRules,
    variantRules,
    allowedProductNamespaces: [...new Set(productRules.map((rule) => rule.namespace))],
    allowedVariantNamespaces: [...new Set(variantRules.map((rule) => rule.namespace))],
  };
}

function normalizeNamespaces(namespaces) {
  if (!Array.isArray(namespaces)) return [];

  return namespaces
    .map((namespace) => String(namespace || "").trim())
    .filter(Boolean);
}

function formatAndFilterProduct(product, {
  productRules,
  variantRules,
  productNamespaces,
  variantNamespaces,
}) {
  const allowedProductRules = productRules.filter((rule) => productNamespaces.includes(rule.namespace));
  const allowedVariantRules = variantRules.filter((rule) => variantNamespaces.includes(rule.namespace));

  const productMetafields = (product.metafields?.nodes || [])
    .filter((metafield) => isMetafieldAllowed(metafield, allowedProductRules))
    .map(pickMetafield);

  const variants = (product.variants?.nodes || []).map((variant) => ({
    id: variant.id,
    title: variant.title,
    sku: variant.sku,
    barcode: variant.barcode,
    price: variant.price,
    inventoryQuantity: variant.inventoryQuantity,
    metafields: (variant.metafields?.nodes || [])
      .filter((metafield) => isMetafieldAllowed(metafield, allowedVariantRules))
      .map(pickMetafield),
  }));

  // Resolve sampling eligibility from the raw (unfiltered) metafields so that
  // the result is always present and correct, regardless of allowed namespaces.
  // Rule: variant-level value takes priority; null variant defers to product level.
  const rawProductNodes = product.metafields?.nodes || [];
  const productSamplingMeta = rawProductNodes.find(
    (m) => m.namespace === 'additional_data' && m.key === 'enable_sampling',
  );
  const productSamplingVal = productSamplingMeta?.value ?? null; // "true" | "false" | null

  let enable_sampling = productSamplingVal === 'true'; // default to product level
  for (const variant of (product.variants?.nodes || [])) {
    const vMeta = (variant.metafields?.nodes || []).find(
      (m) => m.namespace === 'additional_data' && m.key === 'enable_sampling',
    );
    if (vMeta?.value === 'false') { enable_sampling = false; break; }
    if (vMeta?.value === 'true')  { enable_sampling = true; }
    // null → keep product-level value (already set above)
  }

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    vendor: product.vendor,
    productType: product.productType,
    status: product.status,
    tags: product.tags,
    description: product.description,
    enable_sampling,  // resolved boolean — true means orderable via chat
    metafields: productMetafields,
    variants,
  };
}

function isMetafieldAllowed(metafield, rules) {
  return rules.some((rule) => {
    if (rule.namespace !== metafield.namespace) return false;
    return rule.key === '*' || rule.key === metafield.key;
  });
}

function pickMetafield(metafield) {
  return {
    namespace: metafield.namespace,
    key: metafield.key,
    type: metafield.type,
    value: metafield.value,
    jsonValue: metafield.jsonValue,
  };
}

const PRODUCT_FRAGMENT = `
  id
  title
  handle
  vendor
  productType
  status
  tags
  description
  metafields(first: 250) {
    nodes {
      namespace
      key
      type
      value
      jsonValue
    }
  }
  variants(first: $variantLimit) {
    nodes {
      id
      title
      sku
      barcode
      price
      inventoryQuantity
      metafields(first: 250) {
        nodes {
          namespace
          key
          type
          value
          jsonValue
        }
      }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = `
  query ProductById($productId: ID!, $variantLimit: Int!) {
    product(id: $productId) {
      ${PRODUCT_FRAGMENT}
    }
  }
`;

const PRODUCT_BY_HANDLE_QUERY = `
  query ProductByHandle($handle: String!, $variantLimit: Int!) {
    productByHandle(handle: $handle) {
      ${PRODUCT_FRAGMENT}
    }
  }
`;

export default {
  createProductMetafieldsToolService,
};
