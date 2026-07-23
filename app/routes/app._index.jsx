export default function Index() {
  return (
    <s-page>
      <ui-title-bar title="Storefront AI shopping assistant" />

      <s-section>
        <s-stack gap="base">
          <s-heading>AI chatbot setup checklist</s-heading>
          <s-paragraph>
            This app powers a storefront chat assistant that can search products,
            handle carts, and answer policy questions using Shopify MCP tools plus
            your custom FAQ knowledge base.
          </s-paragraph>
          <ol>
            <li>Start app dev with Shopify CLI and open your preview store.</li>
            <li>Enable the theme extension embed in your active theme.</li>
            <li>Add or import FAQs from the FAQ Knowledge tab.</li>
            <li>Test product search, cart updates, shipping, and return questions.</li>
          </ol>
        </s-stack>
      </s-section>

      <s-section heading="App template specs" slot="aside">
        <s-paragraph>
          <s-text>Framework: </s-text>
          <s-link href="https://reactrouter.com/" target="_blank">
            React Router
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Interface: </s-text>
          <s-link
            href="https://shopify.dev/docs/api/app-home/using-polaris-components"
            target="_blank"
          >
            Polaris web components
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>API: </s-text>
          <s-link
            href="https://shopify.dev/docs/api/admin-graphql"
            target="_blank"
          >
            GraphQL
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Database: </s-text>
          <s-link href="https://www.prisma.io/" target="_blank">
            Prisma
          </s-link>
        </s-paragraph>
      </s-section>

      <s-section heading="Next steps" slot="aside">
        <s-text>Open FAQ Knowledge and seed store-specific answers.</s-text>
      </s-section>
    </s-page>
  );
}
