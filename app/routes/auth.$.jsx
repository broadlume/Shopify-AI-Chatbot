import { login, authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.pathname === "/auth/login") {
    return login(request);
  }

  await authenticate.admin(request);

  return null;
};
